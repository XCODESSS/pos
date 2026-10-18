package `in`.counterline

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.security.MessageDigest
import java.sql.Connection
import java.sql.ResultSet
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID
import javax.sql.DataSource

/** Owns orders: server pricing, bill snapshots, cash settlement and kitchen progress. */
class Checkout(private val dataSource: DataSource, private val json: Json, private val inventory: Inventory) {
    private val orderSelect = """
        SELECT o.*, k.status AS kitchen_status, k.version AS kitchen_version,
               k.updated_at AS kitchen_updated_at,
               t.floor || ' / ' || t.label AS current_table_label, s.snapshot AS stock_snapshot
        FROM orders o LEFT JOIN kitchen_tickets k ON k.order_id = o.id
        LEFT JOIN running_checks c ON c.id = o.check_id
        LEFT JOIN dining_tables t ON t.id = c.table_id
        LEFT JOIN order_inventory s ON s.order_id = o.id
    """.trimIndent()
    fun menu(): List<MenuItem> = dataSource.connection.use { menu(it) }

    private fun menu(connection: Connection): List<MenuItem> = connection.prepareStatement(
        "SELECT * FROM menu_items WHERE available ORDER BY category, name",
    ).use { statement ->
        statement.executeQuery().use { rows -> buildList {
            while (rows.next()) add(readMenu(rows, json))
        } }
    }

    fun order(id: String): Order = dataSource.connection.use { connection ->
        find(connection, parseId(id)) ?: throw Problem(404, "not_found", "Order not found.")
    }

    fun create(input: CreateOrder, actor: String): Order {
        checkInput(input.checkId == null, "Submit running-check dishes through the check workspace.")
        return databaseTransaction(dataSource) { createBatch(it, input, actor) }
    }

    internal fun createBatch(connection: Connection, input: CreateOrder, actor: String): Order {
        val request = input.validated()
        val fingerprint = MessageDigest.getInstance("SHA-256")
            .digest(json.encodeToString(request).toByteArray()).joinToString("") { "%02x".format(it) }
        val id = UUID.fromString(request.id)
            find(connection, id)?.let { return replay(connection, id, fingerprint) }
            val menuById = menu(connection).associateBy { it.id }
            val lines = request.lines.map { cartLine ->
                val item = menuById[cartLine.itemId]
                    ?: throw Problem(400, "unavailable_item", "A selected menu item is unavailable.")
                pricedLine(item, cartLine)
            }
            val subtotal = lines.sumOf { it.subtotalPaise }
            val cgst = lines.sumOf { it.cgstPaise }
            val sgst = lines.sumOf { it.sgstPaise }
            checkInput(subtotal + cgst + sgst <= 1_000_000_000L, "Bill exceeds the supported cash settlement limit (INR 1 crore).")
            val createdAt = Instant.now()
            val number = connection.prepareStatement("""
                INSERT INTO orders(id, request_fingerprint, bill, total_paise, created_at, created_by, check_id)
                VALUES (?, ?, '{}'::jsonb, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING RETURNING bill_number
            """.trimIndent()).use { statement ->
                statement.setObject(1, id)
                statement.setString(2, fingerprint)
                statement.setLong(3, subtotal + cgst + sgst)
                statement.setObject(4, createdAt.atOffset(java.time.ZoneOffset.UTC))
                statement.setObject(5, UUID.fromString(actor))
                statement.setObject(6, request.checkId?.let(UUID::fromString))
                statement.executeQuery().use { if (it.next()) it.getLong(1) else null }
            }
            if (number == null) return replay(connection, id, fingerprint)
            val bill = Bill(request.id, "DEMO-${number.toString().padStart(6, '0')}", createdAt.toString(),
                request.orderType, request.tableLabel, lines, subtotal, cgst, sgst, subtotal + cgst + sgst)
            connection.prepareStatement("UPDATE orders SET bill = ?::jsonb WHERE id = ?").use {
                it.setString(1, json.encodeToString(bill)); it.setObject(2, id); it.executeUpdate()
            }
            inventory.consume(connection, id, request.lines, menuById, actor)
            connection.prepareStatement("""
                INSERT INTO kitchen_tickets(order_id, status, updated_at) VALUES (?, 'QUEUED', ?)
            """.trimIndent()).use {
                it.setObject(1, id)
                it.setObject(2, createdAt.atOffset(java.time.ZoneOffset.UTC)); it.executeUpdate()
            }
            audit(connection, actor, "ORDER_CREATED", request.id)
            return find(connection, id) ?: error("Created order missing")
    }

    internal fun batches(connection: Connection, checkId: UUID): List<Order> =
        connection.prepareStatement("$orderSelect WHERE o.check_id = ? ORDER BY o.bill_number").use {
            it.setObject(1, checkId)
            it.executeQuery().use { rows -> buildList { while (rows.next()) add(decode(rows)) } }
        }

    private fun replay(connection: Connection, id: UUID, fingerprint: String): Order {
        val matches = connection.prepareStatement("SELECT request_fingerprint FROM orders WHERE id = ?").use {
            it.setObject(1, id)
            it.executeQuery().use { rows -> rows.next() && rows.getString(1) == fingerprint }
        }
        if (!matches) throw Problem(409, "id_conflict", "This order ID belongs to a different cart.")
        return find(connection, id) ?: error("Committed order missing")
    }

    fun payCash(id: String, payment: CashPayment, actor: String): Order = databaseTransaction(dataSource) { connection ->
        val uuid = parseId(id)
        val order = find(connection, uuid, lock = true)
            ?: throw Problem(404, "not_found", "Order not found.")
        if (order.checkId != null) throw Problem(409, "check_settlement_required", "Settle this kitchen batch through its running check, not as a separate bill.")
        if (order.status == "PAID") {
            if (payment.receivedPaise != order.cashReceivedPaise)
                throw Problem(409, "already_paid", "Cash payment already recorded with a different amount.")
            return@databaseTransaction order
        }
        checkInput(payment.receivedPaise in order.bill.totalPaise..1_000_000_000L,
            "Cash received must cover the bill and not exceed INR 1 crore.")
        connection.prepareStatement("UPDATE orders SET paid_at = ?, cash_received_paise = ?, paid_by = ? WHERE id = ?").use {
            it.setObject(1, Instant.now().atOffset(java.time.ZoneOffset.UTC))
            it.setLong(2, payment.receivedPaise); it.setObject(3, UUID.fromString(actor)); it.setObject(4, uuid); it.executeUpdate()
        }
        audit(connection, actor, "CASH_RECORDED", id)
        find(connection, uuid) ?: error("Settled order missing")
    }

    /** Stable keyset pages, newest bill first; payment status is separate from kitchen state. */
    fun orders(status: String, before: Long?, limit: Int): OrderPage {
        checkInput(status in setOf("ALL", "OPEN", "PAID"), "Status must be ALL, OPEN or PAID.")
        return page(before, limit, kitchen = false, paymentStatus = status)
    }

    /** Oldest active tickets first. Historical orders without tickets are not fabricated. */
    fun kitchen(after: Long?, limit: Int): OrderPage = page(after, limit, kitchen = true)

    private fun page(cursor: Long?, limit: Int, kitchen: Boolean, paymentStatus: String = "ALL"): OrderPage {
        checkInput(limit in 1..100, "Page limit must be between 1 and 100.")
        checkInput(cursor == null || cursor > 0, "Cursor must be a positive bill sequence.")
        val condition = if (kitchen) "k.status <> 'SERVED'" else when (paymentStatus) {
            "OPEN" -> "o.paid_at IS NULL"
            "PAID" -> "o.paid_at IS NOT NULL"
            else -> "TRUE"
        }
        val cursorClause = if (cursor == null) "" else " AND o.bill_number ${if (kitchen) ">" else "<"} ?"
        val direction = if (kitchen) "ASC" else "DESC"
        return dataSource.connection.use { connection ->
            connection.prepareStatement("$orderSelect WHERE $condition$cursorClause ORDER BY o.bill_number $direction LIMIT ?").use {
                var parameter = 1
                if (cursor != null) it.setLong(parameter++, cursor)
                it.setInt(parameter, limit + 1)
                it.executeQuery().use { rows ->
                    val values = buildList {
                        while (rows.next()) add(rows.getLong("bill_number") to decode(rows))
                    }
                    val visible = values.take(limit)
                    OrderPage(visible.map { it.second },
                        if (values.size > limit) visible.last().first.toString() else null)
                }
            }
        }
    }

    fun advanceKitchen(id: String, change: KitchenChange, actor: String): Order = databaseTransaction(dataSource) { connection ->
        checkInput(change.expectedVersion in 0 until Long.MAX_VALUE, "Expected version must be a non-negative integer.")
        val uuid = parseId(id)
        val current = connection.prepareStatement("SELECT * FROM kitchen_tickets WHERE order_id = ? FOR UPDATE").use {
            it.setObject(1, uuid)
            it.executeQuery().use { rows ->
                if (!rows.next()) throw Problem(404, "no_kitchen_ticket", "No kitchen ticket exists for this order.")
                KitchenTicket(KitchenStatus.valueOf(rows.getString("status")), rows.getLong("version"),
                    rows.getTimestamp("updated_at").toInstant().toString())
            }
        }
        // The exact previous transition can be retried after a lost response.
        if (current.version == change.expectedVersion + 1 && current.status == change.status)
            return@databaseTransaction find(connection, uuid) ?: error("Ticket order missing")
        if (current.version != change.expectedVersion)
            throw Problem(409, "stale_kitchen_ticket", "Kitchen ticket changed elsewhere. Refresh before taking another action.")
        if (current.status.next() != change.status)
            throw Problem(409, "invalid_kitchen_transition", "Kitchen tickets must progress queued → preparing → ready → served.")
        connection.prepareStatement("""
            UPDATE kitchen_tickets SET status = ?, version = version + 1, updated_at = ? WHERE order_id = ?
        """.trimIndent()).use {
            it.setString(1, change.status.name)
            it.setObject(2, Instant.now().atOffset(java.time.ZoneOffset.UTC))
            it.setObject(3, uuid); it.executeUpdate()
        }
        audit(connection, actor, "KITCHEN_${change.status}", id)
        find(connection, uuid) ?: error("Updated order missing")
    }

    fun today(): SalesReport {
        val zone = ZoneId.of("Asia/Kolkata")
        val date = LocalDate.now(zone)
        return dataSource.connection.use { connection ->
            connection.prepareStatement("""
                SELECT COUNT(DISTINCT COALESCE(check_id, id)), COALESCE(SUM(total_paise), 0) FROM orders
                WHERE paid_at >= ? AND paid_at < ?
            """.trimIndent()).use {
                it.setObject(1, date.atStartOfDay(zone).toOffsetDateTime())
                it.setObject(2, date.plusDays(1).atStartOfDay(zone).toOffsetDateTime())
                it.executeQuery().use { rows ->
                    rows.next(); SalesReport(date.toString(), zone.id, rows.getLong(1), rows.getLong(2))
                }
            }
        }
    }

    private fun find(connection: Connection, id: UUID, lock: Boolean = false): Order? =
        connection.prepareStatement("$orderSelect WHERE o.id = ?${if (lock) " FOR UPDATE OF o" else ""}").use {
            it.setObject(1, id)
            it.executeQuery().use { rows -> if (rows.next()) decode(rows) else null }
        }

    private fun decode(rows: ResultSet): Order {
        val paidAt = rows.getTimestamp("paid_at")?.toInstant()?.toString()
        val received = rows.getObject("cash_received_paise") as? Long
        val kitchen = rows.getString("kitchen_status")?.let { status ->
            KitchenTicket(KitchenStatus.valueOf(status), rows.getLong("kitchen_version"),
                rows.getTimestamp("kitchen_updated_at").toInstant().toString())
        }
        return Order(json.decodeFromString<Bill>(rows.getString("bill")),
            if (paidAt == null) "OPEN" else "PAID", paidAt, received, kitchen,
            rows.getObject("created_by")?.toString(), rows.getObject("paid_by")?.toString(), rows.getObject("check_id")?.toString(), rows.getString("current_table_label"), rows.getString("stock_snapshot")?.let { json.decodeFromString<StockSnapshot>(it) })
    }

    private fun parseId(id: String): UUID = try { UUID.fromString(id) } catch (_: IllegalArgumentException) {
        throw Problem(400, "invalid_id", "Order ID must be a UUID.")
    }

}
