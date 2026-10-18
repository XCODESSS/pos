package `in`.counterline

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.security.MessageDigest
import java.sql.Connection
import java.sql.ResultSet
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID
import javax.sql.DataSource

@Serializable data class TableWrite(val label: String, val floor: String, val seats: Int, val active: Boolean = true) {
    fun validated(): TableWrite {
        val label = label.trim(); val floor = floor.trim()
        checkInput(label.length in 1..40 && floor.length in 1..60 && (label + floor).none(Char::isISOControl), "Use printable table/floor names (40/60 characters maximum).")
        checkInput(seats in 1..100, "Table capacity must be between 1 and 100.")
        return copy(label = label, floor = floor)
    }
}
@Serializable data class TableCreate(val id: String, val table: TableWrite)
@Serializable data class TableChange(val expectedVersion: Long, val table: TableWrite)
@Serializable data class DiningTable(val id: String, val label: String, val floor: String, val seats: Int, val active: Boolean, val version: Long, val checkId: String?)
@Serializable data class OpenCheck(val id: String, val tableId: String)
@Serializable data class SubmitBatch(val id: String, val expectedVersion: Long, val lines: List<CartLine>)
@Serializable data class CheckTransfer(val id: String, val expectedVersion: Long, val tableId: String)
@Serializable data class CheckCash(val id: String, val expectedVersion: Long, val amountPaise: Long)
@Serializable data class CloseEmptyCheck(val id: String, val expectedVersion: Long)
@Serializable data class CheckPayment(val id: String, val amountPaise: Long, val receivedAt: String, val receivedBy: String)
@Serializable data class RunningCheck(
    val id: String, val number: String, val table: DiningTable, val version: Long,
    val createdAt: String, val closedAt: String?, val status: String,
    val batches: List<Order>, val payments: List<CheckPayment>, val totalPaise: Long, val paidPaise: Long, val duePaise: Long,
)

/** Single-outlet front desk. Writes and aggregate reads share one transaction lock.
 * Batch bills are immutable; payments belong to the check, never to individual KOTs.
 */
class FrontDesk(private val source: DataSource, private val json: Json, private val checkout: Checkout) {
    private val tableSelect = """
        SELECT t.*, c.id AS current_check FROM dining_tables t
        LEFT JOIN running_checks c ON c.table_id = t.id AND c.closed_at IS NULL
    """.trimIndent()

    private fun <T> transaction(action: (Connection) -> T): T = databaseTransaction(source) { connection ->
        // Deliberate single-outlet serialization avoids table-transfer/payment deadlocks.
        connection.prepareStatement("SELECT pg_advisory_xact_lock(27418, 4)").use { it.execute() }
        action(connection)
    }
    fun tables(): List<DiningTable> = source.connection.use { connection ->
        connection.createStatement().use { it.executeQuery("$tableSelect ORDER BY t.floor, t.label").use { rows ->
            buildList { while (rows.next()) add(decodeTable(rows)) }
        } }
    }
    fun createTable(input: TableCreate, actor: String): DiningTable = transaction { connection ->
        val id = uuid(input.id); val value = input.table.validated(); val fingerprint = hash(json.encodeToString(value))
        val existing = tableOrNull(connection, id)
        if (existing != null) {
            val original = connection.prepareStatement("SELECT create_fingerprint FROM dining_tables WHERE id = ?").use {
                it.setObject(1, id); it.executeQuery().use { rows -> rows.next(); rows.getString(1) }
            }
            if (original != fingerprint) conflict("This table ID belongs to another creation request.")
            return@transaction existing
        }
        val count = connection.createStatement().use { it.executeQuery("SELECT COUNT(*) FROM dining_tables").use { rows -> rows.next(); rows.getInt(1) } }
        checkInput(count < 200, "The development outlet supports up to 200 tables.")
        uniqueLocation(connection, id, value)
        connection.prepareStatement("INSERT INTO dining_tables(id,label,floor,seats,active,create_fingerprint) VALUES (?,?,?,?,?,?)").use {
            it.setObject(1, id); it.setString(2, value.label); it.setString(3, value.floor); it.setInt(4, value.seats); it.setBoolean(5, value.active); it.setString(6, fingerprint); it.executeUpdate()
        }
        audit(connection, actor, "TABLE_CREATED", input.id)
        table(connection, id)
    }
    fun changeTable(id: String, input: TableChange, actor: String): DiningTable = transaction { connection ->
        val key = uuid(id); val value = input.table.validated(); val current = table(connection, key)
        version(input.expectedVersion)
        if (current.version == input.expectedVersion + 1 && value == TableWrite(current.label, current.floor, current.seats, current.active)) return@transaction current
        if (current.version != input.expectedVersion) conflict("Table changed elsewhere. Refresh before editing.")
        if (current.checkId != null) conflict("Settle or transfer the occupied check before editing this table.")
        uniqueLocation(connection, key, value)
        connection.prepareStatement("UPDATE dining_tables SET label=?,floor=?,seats=?,active=?,version=version+1 WHERE id=?").use {
            it.setString(1, value.label); it.setString(2, value.floor); it.setInt(3, value.seats); it.setBoolean(4, value.active); it.setObject(5, key); it.executeUpdate()
        }
        audit(connection, actor, "TABLE_UPDATED", id)
        table(connection, key)
    }
    private fun uniqueLocation(connection: Connection, id: UUID, value: TableWrite) {
        connection.prepareStatement("SELECT 1 FROM dining_tables WHERE lower(label)=lower(?) AND lower(floor)=lower(?) AND id<>?").use {
            it.setString(1, value.label); it.setString(2, value.floor); it.setObject(3, id)
            it.executeQuery().use { rows -> if (rows.next()) conflict("A table with that label already exists on this floor.") }
        }
    }
    fun open(input: OpenCheck, actor: String): RunningCheck = transaction { connection ->
        val id = uuid(input.id); val tableId = uuid(input.tableId)
        connection.prepareStatement("SELECT opening_table_id FROM running_checks WHERE id=?").use {
            it.setObject(1, id); it.executeQuery().use { rows -> if (rows.next()) {
                if (rows.getObject(1) != tableId) conflict("This check ID belongs to a different opening request.")
                return@transaction read(connection, id)
            } }
        }
        val target = table(connection, tableId)
        if (!target.active || target.checkId != null) conflict("This table is inactive or already occupied. Refresh tables.")
        connection.prepareStatement("INSERT INTO running_checks(id,table_id,opening_table_id,created_by) VALUES (?,?,?,?)").use {
            it.setObject(1, id); it.setObject(2, tableId); it.setObject(3, tableId); it.setObject(4, uuid(actor)); it.executeUpdate()
        }
        audit(connection, actor, "CHECK_OPENED", input.id)
        read(connection, id)
    }
    fun get(id: String): RunningCheck = transaction { read(it, uuid(id)) }

    fun submit(id: String, input: SubmitBatch, actor: String): RunningCheck = transaction { connection ->
        val key = uuid(id)
        // Canonicalize choices before hashing; expectedVersion is part of the retry intent.
        val normalized = CreateOrder(input.id, input.lines).validated()
        val body = input.copy(id = normalized.id, lines = normalized.lines)
        if (replayed(connection, body.id, key, "batch:" + json.encodeToString(body))) return@transaction read(connection, key)
        val current = writable(connection, key, body.expectedVersion)
        if (current.payments.isNotEmpty()) conflict("Settlement has started. No dishes can be added after the first split payment.")
        checkInput(current.batches.size < 100, "A check supports at most 100 kitchen batches.")
        val order = checkout.createBatch(connection, CreateOrder(body.id, body.lines, OrderType.DINE_IN,
            "${current.table.floor} / ${current.table.label}", id), actor)
        checkInput(current.totalPaise + order.bill.totalPaise <= 1_000_000_000L, "Check exceeds INR 1 crore.")
        remember(connection, body.id, key, "batch:" + json.encodeToString(body))
        bump(connection, key)
        audit(connection, actor, "CHECK_BATCH_SUBMITTED", id)
        read(connection, key)
    }
    fun transfer(id: String, input: CheckTransfer, actor: String): RunningCheck = transaction { connection ->
        val key = uuid(id); val body = input.copy(id = uuid(input.id).toString(), tableId = uuid(input.tableId).toString())
        val fingerprint = "transfer:" + json.encodeToString(body)
        if (replayed(connection, body.id, key, fingerprint)) return@transaction read(connection, key)
        val current = writable(connection, key, body.expectedVersion)
        val target = table(connection, uuid(body.tableId))
        if (!target.active || target.checkId != null || target.id == current.table.id) conflict("Choose an active, unoccupied destination table.")
        connection.prepareStatement("UPDATE running_checks SET table_id=?,version=version+1 WHERE id=?").use {
            it.setObject(1, uuid(body.tableId)); it.setObject(2, key); it.executeUpdate()
        }
        remember(connection, body.id, key, fingerprint)
        audit(connection, actor, "CHECK_TRANSFERRED", id)
        read(connection, key)
    }
    fun pay(id: String, input: CheckCash, actor: String): RunningCheck = transaction { connection ->
        val key = uuid(id); val body = input.copy(id = uuid(input.id).toString()); val fingerprint = "cash:" + json.encodeToString(body)
        if (replayed(connection, body.id, key, fingerprint)) return@transaction read(connection, key)
        val current = writable(connection, key, body.expectedVersion)
        checkInput(body.amountPaise in 1..current.duePaise, "Record exact received cash between one paisa and the remaining balance. Change is not supported for splits.")
        checkInput(current.payments.size < 200, "A check supports at most 200 payments.")
        remember(connection, body.id, key, fingerprint)
        connection.prepareStatement("INSERT INTO check_payments(id,check_id,amount_paise,received_by) VALUES (?,?,?,?)").use {
            it.setObject(1, uuid(body.id)); it.setObject(2, key); it.setLong(3, body.amountPaise); it.setObject(4, uuid(actor)); it.executeUpdate()
        }
        bump(connection, key)
        if (body.amountPaise == current.duePaise) {
            val now = Instant.now().atOffset(ZoneOffset.UTC)
            connection.prepareStatement("UPDATE running_checks SET closed_at=? WHERE id=?").use {
                it.setObject(1, now); it.setObject(2, key); it.executeUpdate()
            }
            // Batches are no longer separately payable. Recognize their unchanged totals exactly once.
            connection.prepareStatement("UPDATE orders SET paid_at=?,cash_received_paise=total_paise,paid_by=? WHERE check_id=?").use {
                it.setObject(1, now); it.setObject(2, uuid(actor)); it.setObject(3, key); it.executeUpdate()
            }
        }
        audit(connection, actor, "CHECK_CASH_RECORDED", id)
        read(connection, key)
    }
    fun closeEmpty(id: String, input: CloseEmptyCheck, actor: String): RunningCheck = transaction { connection ->
        val key = uuid(id); val fingerprint = "close:" + json.encodeToString(input)
        if (replayed(connection, input.id, key, fingerprint)) return@transaction read(connection, key)
        val current = writable(connection, key, input.expectedVersion)
        if (current.batches.isNotEmpty() || current.payments.isNotEmpty()) conflict("Only empty checks can be released without settlement.")
        remember(connection, input.id, key, fingerprint)
        connection.prepareStatement("UPDATE running_checks SET closed_at=CURRENT_TIMESTAMP,version=version+1 WHERE id=?").use {
            it.setObject(1, key); it.executeUpdate()
        }
        audit(connection, actor, "EMPTY_CHECK_CLOSED", id)
        read(connection, key)
    }
    private fun writable(connection: Connection, id: UUID, expectedVersion: Long): RunningCheck {
        version(expectedVersion)
        val value = read(connection, id)
        if (value.closedAt != null) conflict("This check is closed. Reopen its receipt for viewing only.")
        if (value.version != expectedVersion) conflict("Check changed elsewhere. Refresh and review before another action.")
        return value
    }
    private fun read(connection: Connection, id: UUID): RunningCheck = connection.prepareStatement("SELECT * FROM running_checks WHERE id=?").use {
        it.setObject(1, id); it.executeQuery().use { rows ->
            if (!rows.next()) throw Problem(404, "check_not_found", "Running check not found.")
            val batches = checkout.batches(connection, id)
            val payments = connection.prepareStatement("SELECT * FROM check_payments WHERE check_id=? ORDER BY received_at,id").use { statement ->
                statement.setObject(1, id); statement.executeQuery().use { values -> buildList { while (values.next()) add(CheckPayment(
                    values.getObject("id").toString(), values.getLong("amount_paise"), values.getTimestamp("received_at").toInstant().toString(), values.getObject("received_by").toString(),
                )) } }
            }
            val total = batches.sumOf { it.bill.totalPaise }; val paid = payments.sumOf { it.amountPaise }
            val closed = rows.getTimestamp("closed_at")?.toInstant()?.toString()
            RunningCheck(id.toString(), "CHECK-${rows.getLong("check_number").toString().padStart(6, '0')}", table(connection, rows.getObject("table_id") as UUID), rows.getLong("version"),
                rows.getTimestamp("created_at").toInstant().toString(), closed, if (closed != null) "CLOSED" else if (paid > 0) "SETTLING" else "OPEN",
                batches, payments, total, paid, total - paid)
        }
    }
    private fun replayed(connection: Connection, commandId: String, checkId: UUID, payload: String): Boolean {
        val id = uuid(commandId)
        return connection.prepareStatement("SELECT * FROM check_commands WHERE id=?").use {
            it.setObject(1, id); it.executeQuery().use { rows ->
                if (!rows.next()) false else {
                    if (rows.getObject("check_id") != checkId || rows.getString("fingerprint") != hash(payload)) conflict("This command ID belongs to a different action.")
                    true
                }
            }
        }
    }
    private fun remember(connection: Connection, id: String, checkId: UUID, payload: String) {
        connection.prepareStatement("INSERT INTO check_commands(id,check_id,fingerprint) VALUES (?,?,?)").use {
            it.setObject(1, uuid(id)); it.setObject(2, checkId); it.setString(3, hash(payload)); it.executeUpdate()
        }
    }
    private fun bump(connection: Connection, id: UUID) {
        connection.prepareStatement("UPDATE running_checks SET version=version+1 WHERE id=?").use { it.setObject(1, id); it.executeUpdate() }
    }
    private fun tableOrNull(connection: Connection, id: UUID): DiningTable? = connection.prepareStatement("$tableSelect WHERE t.id=?").use {
        it.setObject(1, id); it.executeQuery().use { rows -> if (rows.next()) decodeTable(rows) else null }
    }
    private fun table(connection: Connection, id: UUID) = tableOrNull(connection, id) ?: throw Problem(404, "table_not_found", "Table not found.")
    private fun decodeTable(rows: ResultSet) = DiningTable(rows.getObject("id").toString(), rows.getString("label"), rows.getString("floor"), rows.getInt("seats"), rows.getBoolean("active"), rows.getLong("version"), rows.getObject("current_check")?.toString())
    private fun hash(value: String) = MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString("") { "%02x".format(it) }
    private fun uuid(value: String): UUID {
        val parsed = try { UUID.fromString(value) } catch (_: IllegalArgumentException) { throw Problem(400, "invalid_id", "Use a canonical UUID.") }
        checkInput(parsed.toString() == value, "Use a canonical UUID.")
        return parsed
    }
    private fun version(value: Long) = checkInput(value in 0 until Long.MAX_VALUE, "Invalid expected version.")
    private fun conflict(message: String): Nothing = throw Problem(409, "front_desk_conflict", message)
}
