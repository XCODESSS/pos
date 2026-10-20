package `in`.counterline

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.security.MessageDigest
import java.sql.Connection
import java.sql.ResultSet
import java.time.LocalDate
import java.time.ZoneId
import java.util.Locale
import java.util.UUID
import javax.sql.DataSource

/** Recorded supplier liabilities. Never receives stock or initiates a bank/gateway payment. */
class Payables(private val source: DataSource, private val json: Json) {
    private fun <T> transaction(action: (Connection) -> T): T = databaseTransaction(source) { connection ->
        connection.prepareStatement("SELECT pg_advisory_xact_lock(27418,10)").use { it.execute() }
        action(connection)
    }
    private fun today(): LocalDate = LocalDate.now(ZoneId.of("Asia/Kolkata"))
    private fun fingerprint(value: String) = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
    private fun conflict(message: String): Nothing = throw Problem(409, "payable_conflict", message)
    private fun date(value: String): LocalDate {
        val parsed = try { LocalDate.parse(value) } catch (_: java.time.DateTimeException) { null }
        checkInput(parsed != null && parsed.toString() == value && parsed.year in 2000..2099, "Use a valid YYYY-MM-DD date between 2000 and 2099.")
        return parsed!!
    }
    fun create(input: SupplierBillInput, actor: String): SupplierBill = transaction { connection ->
        val id = stockId(input.id); val supplier = stockId(input.supplierId); val order = input.purchaseOrderId?.let(::stockId)
        val body = input.copy(reference = stockText(input.reference, "Supplier bill reference", 80).replace(Regex("\\s+"), " "))
        val billDate = date(body.billDate); val dueDate = date(body.dueDate)
        checkInput(billDate <= today() && dueDate >= billDate, "Bill date cannot be future; due date cannot precede bill date.")
        checkInput(body.totalPaise in 1..1_000_000_000_000L, "Bill total must be positive integer paise within the supported range.")
        val hash = fingerprint(json.encodeToString(body))
        connection.prepareStatement("SELECT * FROM supplier_bills WHERE id=?").use {
            it.setObject(1, id); it.executeQuery().use { rows -> if (rows.next()) {
                if (rows.getString("fingerprint") != hash) conflict("This bill ID belongs to a different request.")
                return@transaction decodeBill(rows)
            } }
        }
        val name = connection.prepareStatement("SELECT name FROM suppliers WHERE id=?").use {
            it.setObject(1, supplier); it.executeQuery().use { rows -> if (rows.next()) rows.getString(1) else throw Problem(404, "supplier_not_found", "Supplier not found.") }
        }
        if (order != null) connection.prepareStatement("SELECT supplier_id FROM purchase_orders WHERE id=?").use {
            it.setObject(1, order); it.executeQuery().use { rows ->
                if (!rows.next()) throw Problem(404, "purchase_not_found", "Purchase order not found.")
                checkInput(rows.getObject(1).toString() == input.supplierId, "Purchase order must belong to the selected supplier.")
            }
        }
        val referenceKey = body.reference.lowercase(Locale.ROOT)
        connection.prepareStatement("SELECT 1 FROM supplier_bills WHERE supplier_id=? AND reference_key=?").use {
            it.setObject(1, supplier); it.setString(2, referenceKey); it.executeQuery().use { rows -> if (rows.next()) conflict("This supplier bill reference is already recorded, including void bills.") }
        }
        connection.prepareStatement("INSERT INTO supplier_bills(id,supplier_id,supplier_name,purchase_order_id,reference_text,reference_key,bill_date,due_date,total_paise,fingerprint,actor_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)").use {
            it.setObject(1, id); it.setObject(2, supplier); it.setString(3, name); it.setObject(4, order); it.setString(5, body.reference); it.setString(6, referenceKey)
            it.setObject(7, billDate); it.setObject(8, dueDate); it.setLong(9, body.totalPaise); it.setString(10, hash); it.setObject(11, stockId(actor)); it.executeUpdate()
        }
        audit(connection, actor, "SUPPLIER_BILL_RECORDED", input.id); bill(connection, id)
    }
    fun list(before: Long?, limit: Int): SupplierBillPage {
        checkInput(limit in 1..100 && (before == null || before > 0), "Invalid supplier bill history page.")
        return transaction { connection -> connection.prepareStatement("SELECT * FROM supplier_bills${if (before == null) "" else " WHERE sequence<?"} ORDER BY sequence DESC LIMIT ?").use {
            var index = 1; if (before != null) it.setLong(index++, before); it.setInt(index, limit + 1)
            it.executeQuery().use { rows -> val all = buildList { while (rows.next()) add(decodeBill(rows)) }; val visible = all.take(limit)
                SupplierBillPage(visible, if (all.size > limit) visible.last().sequence else null)
            }
        } }
    }
    fun summary(): PayableSummary = transaction { connection ->
        val asOf = today()
        val suppliers = connection.prepareStatement("""
            SELECT s.id,s.name,coalesce(sum(b.total_paise-b.paid_paise),0) AS outstanding,
                   coalesce(sum(CASE WHEN b.due_date < ? THEN b.total_paise-b.paid_paise ELSE 0 END),0) AS overdue,
                   count(b.id) AS open_bills
            FROM suppliers s LEFT JOIN supplier_bills b ON b.supplier_id=s.id AND b.status='OPEN'
            GROUP BY s.id,s.name ORDER BY lower(s.name),s.id
        """.trimIndent()).use {
            it.setObject(1, asOf); it.executeQuery().use { rows -> buildList { while (rows.next()) add(SupplierBalance(rows.getObject("id").toString(), rows.getString("name"),
                rows.getString("outstanding"), rows.getString("overdue"), rows.getString("open_bills"))) } }
        }
        PayableSummary(asOf.toString(), "Asia/Kolkata", suppliers)
    }
    fun get(id: String): SupplierBillDetail = transaction { connection ->
        val key = stockId(id); val current = bill(connection, key)
        val payments = connection.prepareStatement("SELECT * FROM supplier_payments WHERE bill_id=? ORDER BY sequence").use {
            it.setObject(1, key); it.executeQuery().use { rows -> buildList { while (rows.next()) add(decodePayment(rows)) } }
        }
        SupplierBillDetail(current, payments)
    }
    fun pay(billId: String, input: SupplierPaymentInput, actor: String): SupplierPayment = transaction { connection ->
        val key = stockId(billId); val id = stockId(input.id); stockVersion(input.expectedVersion)
        val body = input.copy(reference = stockText(input.reference, "Payment evidence/reference", 120))
        val paymentDate = date(body.paymentDate)
        checkInput(body.amountPaise in 1..1_000_000_000_000L, "Payment must be positive integer paise within the supported range.")
        val hash = fingerprint("$billId:" + json.encodeToString(body))
        connection.prepareStatement("SELECT * FROM supplier_payments WHERE id=?").use {
            it.setObject(1, id); it.executeQuery().use { rows -> if (rows.next()) {
                if (rows.getString("fingerprint") != hash) conflict("This payment ID belongs to a different request.")
                return@transaction decodePayment(rows)
            } }
        }
        val current = bill(connection, key)
        if (current.version != input.expectedVersion || current.status != "OPEN") conflict("Bill changed or is no longer open. Reload and review before recording payment.")
        checkInput(paymentDate >= date(current.billDate) && paymentDate <= today(), "Payment date must be between bill date and today in India.")
        checkInput(body.amountPaise <= current.outstandingPaise, "Payment exceeds the outstanding supplier balance.")
        val count = connection.prepareStatement("SELECT count(*) FROM supplier_payments WHERE bill_id=?").use {
            it.setObject(1, key); it.executeQuery().use { rows -> rows.next(); rows.getInt(1) }
        }
        checkInput(count < 100, "A supplier bill supports at most 100 payment records.")
        checkInput(count < 99 || body.amountPaise == current.outstandingPaise, "The final supported payment record must settle the balance. Do not claim a larger payment than actually made.")
        val payment = connection.prepareStatement("INSERT INTO supplier_payments(id,bill_id,amount_paise,payment_date,method,reference_text,fingerprint,actor_id) VALUES(?,?,?,?,?,?,?,?) RETURNING *").use {
            it.setObject(1, id); it.setObject(2, key); it.setLong(3, body.amountPaise); it.setObject(4, paymentDate); it.setString(5, body.method.name)
            it.setString(6, body.reference); it.setString(7, hash); it.setObject(8, stockId(actor)); it.executeQuery().use { rows -> check(rows.next()); decodePayment(rows) }
        }
        connection.prepareStatement("UPDATE supplier_bills SET paid_paise=paid_paise+?,version=version+1,status=? WHERE id=?").use {
            it.setLong(1, body.amountPaise); it.setString(2, if (body.amountPaise == current.outstandingPaise) "PAID" else "OPEN"); it.setObject(3, key); it.executeUpdate()
        }
        audit(connection, actor, "SUPPLIER_PAYMENT_RECORDED", input.id); payment
    }
    fun void(billId: String, input: SupplierBillVoid, actor: String): SupplierBill = transaction { connection ->
        val key = stockId(billId); val command = stockId(input.id); stockVersion(input.expectedVersion)
        val body = input.copy(reason = stockText(input.reason, "Void reason", 200)); val hash = fingerprint("$billId:" + json.encodeToString(body))
        connection.prepareStatement("SELECT * FROM supplier_bills WHERE void_command_id=?").use {
            it.setObject(1, command); it.executeQuery().use { rows -> if (rows.next()) {
                if (rows.getString("void_fingerprint") != hash) conflict("This void command belongs to a different request.")
                return@transaction decodeBill(rows)
            } }
        }
        val current = bill(connection, key)
        if (current.version != input.expectedVersion || current.status != "OPEN" || current.paidPaise != 0L) conflict("Only an unchanged, unpaid open bill can be voided. Reload and review.")
        connection.prepareStatement("UPDATE supplier_bills SET version=version+1,status='VOID',void_command_id=?,void_fingerprint=?,void_reason=?,voided_by=?,voided_at=CURRENT_TIMESTAMP WHERE id=?").use {
            it.setObject(1, command); it.setString(2, hash); it.setString(3, body.reason); it.setObject(4, stockId(actor)); it.setObject(5, key); it.executeUpdate()
        }
        audit(connection, actor, "SUPPLIER_BILL_VOIDED", billId); bill(connection, key)
    }
    private fun decodePayment(rows: ResultSet) = SupplierPayment(rows.getObject("id").toString(), rows.getLong("sequence").toString(), rows.getObject("bill_id").toString(),
        rows.getLong("amount_paise"), rows.getDate("payment_date").toLocalDate().toString(), SupplierPaymentMethod.valueOf(rows.getString("method")), rows.getString("reference_text"),
        rows.getObject("actor_id").toString(), rows.getTimestamp("created_at").toInstant().toString())
    private fun bill(connection: Connection, id: UUID): SupplierBill = connection.prepareStatement("SELECT * FROM supplier_bills WHERE id=?").use {
        it.setObject(1, id); it.executeQuery().use { rows -> if (rows.next()) decodeBill(rows) else throw Problem(404, "supplier_bill_not_found", "Supplier bill not found.") }
    }
    private fun decodeBill(rows: ResultSet): SupplierBill {
        val outstanding = if (rows.getString("status") == "VOID") 0 else rows.getLong("total_paise") - rows.getLong("paid_paise")
        return SupplierBill(rows.getObject("id").toString(), rows.getLong("sequence").toString(), rows.getObject("supplier_id").toString(), rows.getString("supplier_name"),
            rows.getObject("purchase_order_id")?.toString(), rows.getString("reference_text"), rows.getDate("bill_date").toLocalDate().toString(), rows.getDate("due_date").toLocalDate().toString(),
            rows.getLong("total_paise"), rows.getLong("paid_paise"), outstanding, outstanding > 0 && rows.getDate("due_date").toLocalDate() < today(), rows.getString("status"), rows.getLong("version"),
            rows.getObject("actor_id").toString(), rows.getTimestamp("created_at").toInstant().toString(), rows.getString("void_reason"), rows.getObject("voided_by")?.toString(), rows.getTimestamp("voided_at")?.toInstant()?.toString())
    }
}
