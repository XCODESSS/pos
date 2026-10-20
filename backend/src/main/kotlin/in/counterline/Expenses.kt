package `in`.counterline

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.security.MessageDigest
import java.sql.Connection
import java.sql.ResultSet
import java.time.LocalDate
import java.time.ZoneId
import javax.sql.DataSource

@Serializable data class ExpenseInput(val id: String, val payee: String, val category: String, val reference: String,
    val expenseDate: String, val amountPaise: Long, val method: SupplierPaymentMethod, val cashShiftId: String? = null)
@Serializable data class Expense(val id: String, val sequence: String, val payee: String, val category: String, val reference: String,
    val expenseDate: String, val amountPaise: Long, val method: SupplierPaymentMethod, val cashShiftId: String?, val actorId: String, val createdAt: String)
@Serializable data class ExpensePage(val expenses: List<Expense>, val nextCursor: String?)

/** Immediate operating spending, not supplier liabilities or inventory procurement. */
class Expenses(private val source: DataSource, private val json: Json, private val cash: CashControl) {
    fun record(input: ExpenseInput, actor: String): Expense = databaseTransaction(source) { connection ->
        connection.prepareStatement("SELECT pg_advisory_xact_lock(27418,12)").use { it.execute() }
        val id = stockId(input.id)
        val body = input.copy(payee = stockText(input.payee, "Payee", 80), category = stockText(input.category, "Category", 60), reference = stockText(input.reference, "Expense reference", 120))
        checkInput(body.amountPaise in 1..1_000_000_000_000L, "Expense must be positive integer paise within the supported range.")
        val date = try { LocalDate.parse(body.expenseDate) } catch (_: java.time.DateTimeException) { null }
        checkInput(date != null && date.toString() == body.expenseDate && date.year in 2000..2099 && date <= LocalDate.now(ZoneId.of("Asia/Kolkata")), "Expense date must be a valid YYYY-MM-DD from 2000 through today in India.")
        val hash = MessageDigest.getInstance("SHA-256").digest(json.encodeToString(body).toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
        connection.prepareStatement("SELECT * FROM operating_expenses WHERE id=?").use {
            it.setObject(1, id); it.executeQuery().use { rows -> if (rows.next()) {
                if (rows.getString("fingerprint") != hash) throw Problem(409, "expense_conflict", "This expense ID belongs to a different request.")
                return@databaseTransaction decode(rows)
            } }
        }
        if (body.method == SupplierPaymentMethod.CASH) {
            cash.requireToday(body.expenseDate)
            cash.post(connection, body.cashShiftId, CashKind.EXPENSE, body.id, body.amountPaise, actor)
        } else checkInput(body.cashShiftId == null, "Noncash expenses cannot be assigned to a cash shift.")
        val result = connection.prepareStatement("INSERT INTO operating_expenses(id,payee,category,reference_text,expense_date,amount_paise,method,cash_shift_id,fingerprint,actor_id) VALUES(?,?,?,?,?,?,?,?,?,?) RETURNING *").use {
            it.setObject(1, id); it.setString(2, body.payee); it.setString(3, body.category); it.setString(4, body.reference); it.setObject(5, date); it.setLong(6, body.amountPaise)
            it.setString(7, body.method.name); it.setObject(8, body.cashShiftId?.let(::stockId)); it.setString(9, hash); it.setObject(10, stockId(actor)); it.executeQuery().use { rows -> check(rows.next()); decode(rows) }
        }
        audit(connection, actor, "OPERATING_EXPENSE_RECORDED", body.id); result
    }
    fun get(id: String): Expense = source.connection.use { connection -> connection.prepareStatement("SELECT * FROM operating_expenses WHERE id=?").use {
        it.setObject(1, stockId(id)); it.executeQuery().use { rows -> if (rows.next()) decode(rows) else throw Problem(404, "expense_not_found", "Operating expense not found.") }
    } }
    fun list(before: Long?, limit: Int): ExpensePage {
        checkInput(limit in 1..100 && (before == null || before > 0), "Invalid expense history page.")
        return source.connection.use { connection -> connection.prepareStatement("SELECT * FROM operating_expenses${if (before == null) "" else " WHERE sequence<?"} ORDER BY sequence DESC LIMIT ?").use {
            var index = 1; if (before != null) it.setLong(index++, before); it.setInt(index, limit + 1)
            it.executeQuery().use { rows -> val all = buildList { while (rows.next()) add(decode(rows)) }; val visible = all.take(limit)
                ExpensePage(visible, if (all.size > limit) visible.last().sequence else null)
            }
        } }
    }
    private fun decode(rows: ResultSet) = Expense(rows.getObject("id").toString(), rows.getLong("sequence").toString(), rows.getString("payee"), rows.getString("category"), rows.getString("reference_text"),
        rows.getDate("expense_date").toLocalDate().toString(), rows.getLong("amount_paise"), SupplierPaymentMethod.valueOf(rows.getString("method")), rows.getObject("cash_shift_id")?.toString(),
        rows.getObject("actor_id").toString(), rows.getTimestamp("created_at").toInstant().toString())
}
