package `in`.counterline

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.security.MessageDigest
import java.sql.Connection
import java.sql.ResultSet
import java.util.UUID
import javax.sql.DataSource

private const val CASH_LIMIT = 1_000_000_000_000L
/** Shared drawer. Other modules post within their transaction; this module never acquires their locks. */
class CashControl(private val source: DataSource, private val json: Json) {
    private fun lock(connection: Connection) { connection.prepareStatement("SELECT pg_advisory_xact_lock(27418,11)").use { it.execute() } }
    private fun <T> transaction(action: (Connection) -> T): T = databaseTransaction(source) { connection -> lock(connection); action(connection) }
    private fun hash(value: String) = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
    private fun conflict(message: String): Nothing = throw Problem(409, "cash_conflict", message)
    internal fun requireToday(date: String) {
        checkInput(date == java.time.LocalDate.now(java.time.ZoneId.of("Asia/Kolkata")).toString(), "Cash outflows must use today's India date and the selected open drawer.")
    }
    internal fun post(connection: Connection, shiftId: String?, kind: CashKind, sourceId: String, amountPaise: Long, actor: String) {
        lock(connection)
        if (shiftId == null) conflict("An open cash shift is required. Ask an owner/manager to open the drawer, then review the cash action.")
        val key = stockId(shiftId); val current = shift(connection, key)
        if (current.status != "OPEN") conflict("The selected cash shift is closed. Review the action against the correct drawer; do not rebase a pending command.")
        checkInput(amountPaise in 0..CASH_LIMIT, "Cash amount exceeds the supported range.")
        val incoming = kind == CashKind.SALE || kind == CashKind.CHECK_PAYMENT
        val delta = if (incoming) amountPaise else -amountPaise
        val column = when (kind) { CashKind.SALE, CashKind.CHECK_PAYMENT -> "sales_paise"; CashKind.EXPENSE -> "expenses_paise"; CashKind.SUPPLIER_PAYMENT -> "supplier_paise" }
        val total = when (kind) { CashKind.SALE, CashKind.CHECK_PAYMENT -> current.salesPaise; CashKind.EXPENSE -> current.expensesPaise; CashKind.SUPPLIER_PAYMENT -> current.supplierPaise }
        checkInput(total + amountPaise <= CASH_LIMIT && current.expectedPaise + delta in -CASH_LIMIT..CASH_LIMIT, "Cash shift totals exceed the supported range.")
        connection.prepareStatement("INSERT INTO cash_movements(shift_id,kind,source_id,amount_paise,delta_paise,balance_paise,actor_id) VALUES(?,?,?,?,?,?,?)").use {
            it.setObject(1, key); it.setString(2, kind.name); it.setObject(3, stockId(sourceId)); it.setLong(4, amountPaise); it.setLong(5, delta); it.setLong(6, current.expectedPaise + delta); it.setObject(7, stockId(actor)); it.executeUpdate()
        }
        connection.prepareStatement("UPDATE cash_shifts SET $column=$column+?,expected_paise=expected_paise+?,version=version+1 WHERE id=?").use {
            it.setLong(1, amountPaise); it.setLong(2, delta); it.setObject(3, key); it.executeUpdate()
        }
    }
    fun movements(id: String, before: Long?, limit: Int): CashMovementPage = transaction { connection ->
        checkInput(limit in 1..100 && (before == null || before > 0), "Invalid cash movement page.")
        val key = stockId(id); shift(connection, key)
        connection.prepareStatement("SELECT * FROM cash_movements WHERE shift_id=?${if (before == null) "" else " AND sequence<?"} ORDER BY sequence DESC LIMIT ?").use {
            it.setObject(1, key); var index = 2; if (before != null) it.setLong(index++, before); it.setInt(index, limit + 1)
            it.executeQuery().use { rows -> val all = buildList { while (rows.next()) add(CashMovement(rows.getLong("sequence").toString(), rows.getObject("shift_id").toString(), CashKind.valueOf(rows.getString("kind")),
                rows.getObject("source_id").toString(), rows.getLong("amount_paise"), rows.getLong("delta_paise"), rows.getLong("balance_paise"), rows.getObject("actor_id").toString(), rows.getTimestamp("created_at").toInstant().toString())) }
                val visible = all.take(limit); CashMovementPage(visible, if (all.size > limit) visible.last().sequence else null)
            }
        }
    }
    fun list(before: Long?, limit: Int): CashShiftPage = transaction { connection ->
        checkInput(limit in 1..100 && (before == null || before > 0), "Invalid cash shift page.")
        connection.prepareStatement("SELECT * FROM cash_shifts${if (before == null) "" else " WHERE sequence<?"} ORDER BY sequence DESC LIMIT ?").use {
            var index = 1; if (before != null) it.setLong(index++, before); it.setInt(index, limit + 1)
            it.executeQuery().use { rows -> val all = buildList { while (rows.next()) add(decode(rows)) }; val visible = all.take(limit)
                CashShiftPage(visible, if (all.size > limit) visible.last().sequence else null)
            }
        }
    }
    fun active(): CashActive = transaction { connection ->
        CashActive(current(connection)?.let { ActiveCashShift(it.id, it.sequence) })
    }
    private fun current(connection: Connection): CashShift? = connection.createStatement().use {
        it.executeQuery("SELECT * FROM cash_shifts WHERE status='OPEN'").use { rows -> if (rows.next()) decode(rows) else null }
    }
    fun get(id: String): CashShift = transaction { shift(it, stockId(id)) }
    fun open(input: CashOpen, actor: String): CashShift = transaction { connection ->
        val id = stockId(input.id); val body = input.copy(reference = stockText(input.reference, "Opening reference", 120))
        checkInput(body.openingPaise in 0..CASH_LIMIT, "Opening float must be nonnegative integer paise within the supported range.")
        val fingerprint = hash(json.encodeToString(body))
        connection.prepareStatement("SELECT * FROM cash_shifts WHERE id=?").use {
            it.setObject(1, id); it.executeQuery().use { rows -> if (rows.next()) {
                if (rows.getString("fingerprint") != fingerprint) conflict("This shift ID belongs to a different opening request.")
                return@transaction decode(rows)
            } }
        }
        if (current(connection) != null) conflict("The shared drawer already has an open shift. Close it before opening another.")
        connection.prepareStatement("INSERT INTO cash_shifts(id,reference_text,opening_paise,expected_paise,fingerprint,opened_by) VALUES(?,?,?,?,?,?)").use {
            it.setObject(1, id); it.setString(2, body.reference); it.setLong(3, body.openingPaise); it.setLong(4, body.openingPaise); it.setString(5, fingerprint); it.setObject(6, stockId(actor)); it.executeUpdate()
        }
        audit(connection, actor, "CASH_SHIFT_OPENED", input.id); shift(connection, id)
    }
    fun close(id: String, input: CashClose, actor: String): CashShift = transaction { connection ->
        val key = stockId(id); val command = stockId(input.id); stockVersion(input.expectedVersion)
        val body = input.copy(reason = input.reason.trim())
        checkInput(body.countedPaise in 0..CASH_LIMIT, "Counted cash must be nonnegative integer paise within the supported range.")
        checkInput(body.reason.length <= 200 && body.reason.none(Char::isISOControl), "Close reason must be at most 200 printable characters.")
        val fingerprint = hash("$id:" + json.encodeToString(body))
        connection.prepareStatement("SELECT * FROM cash_shifts WHERE close_command_id=?").use {
            it.setObject(1, command); it.executeQuery().use { rows -> if (rows.next()) {
                if (rows.getString("close_fingerprint") != fingerprint) conflict("This close command belongs to a different request.")
                return@transaction decode(rows)
            } }
        }
        val current = shift(connection, key)
        if (current.status != "OPEN" || current.version != input.expectedVersion) conflict("Drawer changed or closed. Reload and recount before closing.")
        val discrepancy = body.countedPaise - current.expectedPaise
        checkInput(discrepancy == 0L || body.reason.isNotBlank(), "Explain the difference between counted and expected cash.")
        connection.prepareStatement("UPDATE cash_shifts SET status='CLOSED',version=version+1,close_command_id=?,close_fingerprint=?,counted_paise=?,discrepancy_paise=?,close_reason=?,closed_by=?,closed_at=CURRENT_TIMESTAMP WHERE id=?").use {
            it.setObject(1, command); it.setString(2, fingerprint); it.setLong(3, body.countedPaise); it.setLong(4, discrepancy); it.setString(5, body.reason); it.setObject(6, stockId(actor)); it.setObject(7, key); it.executeUpdate()
        }
        audit(connection, actor, "CASH_SHIFT_CLOSED", id); shift(connection, key)
    }
    private fun shift(connection: Connection, id: UUID): CashShift = connection.prepareStatement("SELECT * FROM cash_shifts WHERE id=?").use {
        it.setObject(1, id); it.executeQuery().use { rows -> if (rows.next()) decode(rows) else throw Problem(404, "cash_shift_not_found", "Cash shift not found.") }
    }
    private fun decode(rows: ResultSet) = CashShift(rows.getObject("id").toString(), rows.getLong("sequence").toString(), rows.getString("status"), rows.getString("reference_text"),
        rows.getLong("opening_paise"), rows.getLong("sales_paise"), rows.getLong("expenses_paise"), rows.getLong("supplier_paise"), rows.getLong("expected_paise"), rows.getLong("version"),
        rows.getObject("opened_by").toString(), rows.getTimestamp("opened_at").toInstant().toString(), rows.getObject("counted_paise") as? Long, rows.getObject("discrepancy_paise") as? Long,
        rows.getString("close_reason"), rows.getObject("closed_by")?.toString(), rows.getTimestamp("closed_at")?.toInstant()?.toString())
}
