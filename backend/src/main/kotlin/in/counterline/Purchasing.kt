package `in`.counterline

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.security.MessageDigest
import java.sql.Connection
import java.sql.ResultSet
import java.util.UUID
import javax.sql.DataSource

/** Quantity procurement, not accounts payable. All writes share the authoritative inventory lock. */
class Purchasing(private val source: DataSource, private val json: Json, private val inventory: Inventory) {
    private fun fingerprint(value: String) = MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString("") { "%02x".format(it) }
    private fun conflict(message: String): Nothing = throw Problem(409, "purchase_conflict", message)
    private fun validateLines(ids: List<String>) {
        checkInput(ids.size in 1..100 && ids.distinct().size == ids.size, "Use between 1 and 100 unique ingredients.")
        ids.forEach(::stockId)
    }
    fun suppliers(): SupplierList = source.connection.use { connection ->
        connection.createStatement().use { it.executeQuery("SELECT * FROM suppliers ORDER BY lower(name),id").use { rows -> SupplierList(buildList { while (rows.next()) add(decodeSupplier(rows)) }) } }
    }
    fun createSupplier(input: SupplierInput, actor: String): Supplier = inventory.transaction { connection ->
        val id = stockId(input.id); val body = input.copy(name = stockText(input.name, "Supplier name", 80), contact = input.contact.trim())
        checkInput(body.contact.length <= 120 && body.contact.none(Char::isISOControl), "Supplier contact must have at most 120 printable characters.")
        val hash = fingerprint(json.encodeToString(body))
        connection.prepareStatement("SELECT * FROM suppliers WHERE id=?").use {
            it.setObject(1, id); it.executeQuery().use { rows -> if (rows.next()) {
                if (rows.getString("fingerprint") != hash) conflict("This supplier ID belongs to a different request.")
                return@transaction decodeSupplier(rows)
            } }
        }
        connection.prepareStatement("SELECT 1 FROM suppliers WHERE lower(name)=lower(?)").use {
            it.setString(1, body.name); it.executeQuery().use { rows -> if (rows.next()) conflict("A supplier with this name already exists.") }
        }
        val count = connection.createStatement().use { it.executeQuery("SELECT count(*) FROM suppliers").use { rows -> rows.next(); rows.getInt(1) } }
        checkInput(count < 500, "The current outlet supports at most 500 suppliers.")
        val result = connection.prepareStatement("INSERT INTO suppliers(id,name,contact,fingerprint,actor_id) VALUES(?,?,?,?,?) RETURNING *").use {
            it.setObject(1, id); it.setString(2, body.name); it.setString(3, body.contact); it.setString(4, hash); it.setObject(5, stockId(actor))
            it.executeQuery().use { rows -> check(rows.next()); decodeSupplier(rows) }
        }
        audit(connection, actor, "SUPPLIER_CREATED", id.toString()); result
    }
    fun createOrder(input: PurchaseInput, actor: String): PurchaseOrder = inventory.transaction { connection ->
        val id = stockId(input.id); val supplierId = stockId(input.supplierId)
        validateLines(input.lines.map { it.ingredientId }); input.lines.forEach { checkInput(it.quantityMilli in 1..STOCK_LIMIT, "Ordered quantities must be positive and within the supported range.") }
        val body = input.copy(reference = stockText(input.reference, "Purchase reference", 80), lines = input.lines.sortedBy { it.ingredientId })
        val hash = fingerprint(json.encodeToString(body))
        connection.prepareStatement("SELECT * FROM purchase_orders WHERE id=?").use {
            it.setObject(1, id); it.executeQuery().use { rows -> if (rows.next()) {
                if (rows.getString("fingerprint") != hash) conflict("This purchase order ID belongs to a different request.")
                return@transaction decodeOrder(rows)
            } }
        }
        val supplier = connection.prepareStatement("SELECT * FROM suppliers WHERE id=?").use {
            it.setObject(1, supplierId); it.executeQuery().use { rows -> if (rows.next()) decodeSupplier(rows) else throw Problem(404, "supplier_not_found", "Supplier not found.") }
        }
        val lines = body.lines.map { line -> val item = inventory.ingredient(connection, stockId(line.ingredientId)); PurchaseLine(item.id, item.name, item.unit, line.quantityMilli) }
        connection.prepareStatement("INSERT INTO purchase_orders(id,supplier_id,supplier_name,reference_text,fingerprint,actor_id,lines) VALUES(?,?,?,?,?,?,?::jsonb)").use {
            it.setObject(1, id); it.setObject(2, supplierId); it.setString(3, supplier.name); it.setString(4, body.reference); it.setString(5, hash); it.setObject(6, stockId(actor)); it.setString(7, json.encodeToString(lines)); it.executeUpdate()
        }
        audit(connection, actor, "PURCHASE_ORDER_CREATED", id.toString()); order(connection, id)
    }
    fun list(before: Long?, limit: Int): PurchasePage {
        checkInput(limit in 1..100 && (before == null || before > 0), "Invalid purchase history page.")
        return source.connection.use { connection -> connection.prepareStatement("SELECT * FROM purchase_orders${if (before == null) "" else " WHERE sequence<?"} ORDER BY sequence DESC LIMIT ?").use {
            var index = 1; if (before != null) it.setLong(index++, before); it.setInt(index, limit + 1)
            it.executeQuery().use { rows -> val all = buildList { while (rows.next()) add(decodeOrder(rows)) }; val visible = all.take(limit)
                PurchasePage(visible, if (all.size > limit) visible.last().sequence else null)
            }
        } }
    }
    // Hold the same lock for an aggregate read so order quantities and receipts cannot come from different commits.
    fun get(id: String): PurchaseDetail = inventory.transaction { connection ->
        val key = stockId(id); val current = order(connection, key)
        val receipts = connection.prepareStatement("SELECT * FROM purchase_receipts WHERE purchase_order_id=? ORDER BY sequence").use {
            it.setObject(1, key); it.executeQuery().use { rows -> buildList { while (rows.next()) add(decodeReceipt(rows)) } }
        }
        PurchaseDetail(current, receipts)
    }
    fun receive(orderId: String, input: PurchaseReceive, actor: String): PurchaseReceipt = inventory.transaction { connection ->
        val key = stockId(orderId); val id = stockId(input.id); stockVersion(input.expectedVersion)
        validateLines(input.lines.map { it.ingredientId })
        input.lines.forEach { stockVersion(it.expectedStockVersion); checkInput(it.quantityMilli in 1..STOCK_LIMIT, "Delivery quantities must be positive and within the supported range.") }
        val body = input.copy(reference = stockText(input.reference, "Delivery reference", 80), lines = input.lines.sortedBy { it.ingredientId })
        val hash = fingerprint("$orderId:" + json.encodeToString(body))
        connection.prepareStatement("SELECT * FROM purchase_receipts WHERE id=?").use {
            it.setObject(1, id); it.executeQuery().use { rows -> if (rows.next()) {
                if (rows.getString("fingerprint") != hash) conflict("This delivery receipt ID belongs to a different request.")
                return@transaction decodeReceipt(rows)
            } }
        }
        val current = order(connection, key)
        if (current.version != body.expectedVersion || current.status != "OPEN") conflict("Purchase order changed or is no longer open. Reload and review before receiving.")
        val count = connection.prepareStatement("SELECT count(*) FROM purchase_receipts WHERE purchase_order_id=?").use {
            it.setObject(1, key); it.executeQuery().use { rows -> rows.next(); rows.getInt(1) }
        }
        checkInput(count < 100, "A purchase order supports at most 100 deliveries.")
        val ingredients = body.lines.map { inventory.ingredient(connection, stockId(it.ingredientId)) }
        val lines = body.lines.zip(ingredients).map { (line, item) ->
            val ordered = current.lines.find { it.ingredientId == line.ingredientId } ?: throw Problem(400, "invalid_delivery", "Delivery ingredient is not on this purchase order.")
            if (item.version != line.expectedStockVersion) conflict("Stock changed while receiving. Reload and review the delivery before retrying.")
            checkInput(line.quantityMilli <= ordered.orderedMilli - ordered.receivedMilli, "Delivery exceeds the unreceived purchase quantity.")
            checkInput(item.balanceMilli + line.quantityMilli in -STOCK_LIMIT..STOCK_LIMIT, "Resulting stock quantity exceeds the supported numeric range.")
            PurchaseReceiptLine(item.id, item.name, item.unit, line.quantityMilli, item.balanceMilli + line.quantityMilli)
        }
        val receipt = connection.prepareStatement("INSERT INTO purchase_receipts(id,purchase_order_id,reference_text,fingerprint,actor_id,lines) VALUES(?,?,?,?,?,?::jsonb) RETURNING *").use {
            it.setObject(1, id); it.setObject(2, key); it.setString(3, body.reference); it.setString(4, hash); it.setObject(5, stockId(actor)); it.setString(6, json.encodeToString(lines))
            it.executeQuery().use { rows -> check(rows.next()); decodeReceipt(rows) }
        }
        body.lines.zip(ingredients).forEach { (line, item) -> inventory.receivePurchase(connection, item, line.quantityMilli, actor, body.reference, id) }
        val quantities = body.lines.associate { it.ingredientId to it.quantityMilli }
        val updated = current.lines.map { it.copy(receivedMilli = it.receivedMilli + (quantities[it.ingredientId] ?: 0)) }
        connection.prepareStatement("UPDATE purchase_orders SET version=version+1,status=?,lines=?::jsonb WHERE id=?").use {
            it.setString(1, if (updated.all { line -> line.orderedMilli == line.receivedMilli }) "RECEIVED" else "OPEN"); it.setString(2, json.encodeToString(updated)); it.setObject(3, key); it.executeUpdate()
        }
        audit(connection, actor, "PURCHASE_DELIVERY_RECEIVED", id.toString()); receipt
    }
    fun close(orderId: String, input: PurchaseClose, actor: String): PurchaseOrder = inventory.transaction { connection ->
        val key = stockId(orderId); val command = stockId(input.id); stockVersion(input.expectedVersion)
        val body = input.copy(reason = stockText(input.reason, "Close reason", 200))
        val hash = fingerprint("$orderId:" + json.encodeToString(body))
        connection.prepareStatement("SELECT * FROM purchase_orders WHERE close_command_id=?").use {
            it.setObject(1, command); it.executeQuery().use { rows -> if (rows.next()) {
                if (rows.getString("close_fingerprint") != hash) conflict("This close command belongs to a different request.")
                return@transaction decodeOrder(rows)
            } }
        }
        val current = order(connection, key)
        if (current.version != input.expectedVersion || current.status != "OPEN") conflict("Purchase order changed or is no longer open. Reload and review before closing.")
        connection.prepareStatement("UPDATE purchase_orders SET version=version+1,status='CLOSED',close_command_id=?,close_fingerprint=?,close_reason=?,closed_by=?,closed_at=CURRENT_TIMESTAMP WHERE id=?").use {
            it.setObject(1, command); it.setString(2, hash); it.setString(3, body.reason); it.setObject(4, stockId(actor)); it.setObject(5, key); it.executeUpdate()
        }
        audit(connection, actor, "PURCHASE_REMAINDER_CLOSED", orderId); order(connection, key)
    }
    private fun order(connection: Connection, id: UUID): PurchaseOrder = connection.prepareStatement("SELECT * FROM purchase_orders WHERE id=?").use {
        it.setObject(1, id); it.executeQuery().use { rows -> if (rows.next()) decodeOrder(rows) else throw Problem(404, "purchase_not_found", "Purchase order not found.") }
    }
    private fun decodeSupplier(rows: ResultSet) = Supplier(rows.getObject("id").toString(), rows.getString("name"), rows.getString("contact"), rows.getObject("actor_id").toString(), rows.getTimestamp("created_at").toInstant().toString())
    private fun decodeOrder(rows: ResultSet) = PurchaseOrder(rows.getObject("id").toString(), rows.getLong("sequence").toString(), rows.getObject("supplier_id").toString(), rows.getString("supplier_name"),
        rows.getString("reference_text"), rows.getObject("actor_id").toString(), rows.getTimestamp("created_at").toInstant().toString(), rows.getLong("version"), rows.getString("status"), json.decodeFromString(rows.getString("lines")),
        rows.getString("close_reason"), rows.getObject("closed_by")?.toString(), rows.getTimestamp("closed_at")?.toInstant()?.toString())
    private fun decodeReceipt(rows: ResultSet) = PurchaseReceipt(rows.getObject("id").toString(), rows.getLong("sequence").toString(), rows.getObject("purchase_order_id").toString(),
        rows.getString("reference_text"), rows.getObject("actor_id").toString(), rows.getTimestamp("created_at").toInstant().toString(), json.decodeFromString(rows.getString("lines")))
}
