package `in`.counterline

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.security.MessageDigest
import java.sql.Connection
import java.sql.ResultSet
import java.util.UUID
import javax.sql.DataSource

@Serializable data class StockCountLineInput(val ingredientId: String, val expectedVersion: Long, val countedMilli: Long)
@Serializable data class StockCountInput(val id: String, val reason: String, val lines: List<StockCountLineInput>)
@Serializable data class StockCountLine(val ingredientId: String, val ingredientName: String, val unit: StockUnit,
    val observedVersion: Long, val recordedMilli: Long, val countedMilli: Long, val varianceMilli: Long)
@Serializable data class StockCount(val id: String, val sequence: String, val reason: String, val actorId: String,
    val createdAt: String, val lines: List<StockCountLine>)
@Serializable data class StockCountPage(val counts: List<StockCount>, val nextCursor: String?)

/** Immutable observations and reviewed corrections; the inventory ledger owns all balance changes. */
class StockCounts(private val source: DataSource, private val json: Json, private val inventory: Inventory) {
    fun record(input: StockCountInput, actor: String): StockCount = inventory.transaction { connection ->
        val id = stockId(input.id)
        val reason = stockText(input.reason, "Count reason", 200)
        checkInput(input.lines.size in 1..100 && input.lines.map { it.ingredientId }.distinct().size == input.lines.size, "Count between 1 and 100 unique ingredients.")
        val inputs = input.lines.sortedBy { it.ingredientId }
        inputs.forEach { stockId(it.ingredientId); stockVersion(it.expectedVersion); checkInput(it.countedMilli in 0..STOCK_LIMIT, "Physical quantities must be nonnegative and within the supported range.") }
        val body = input.copy(reason = reason, lines = inputs)
        val fingerprint = MessageDigest.getInstance("SHA-256").digest(json.encodeToString(body).toByteArray()).joinToString("") { "%02x".format(it) }
        connection.prepareStatement("SELECT * FROM stock_counts WHERE id=?").use {
            it.setObject(1, id); it.executeQuery().use { rows -> if (rows.next()) {
                if (rows.getString("fingerprint") != fingerprint) throw Problem(409, "inventory_conflict", "This stock count ID belongs to a different intent.")
                return@transaction decode(rows)
            } }
        }
        val ingredients = inputs.map { inventory.ingredient(connection, stockId(it.ingredientId)) }
        val lines = inputs.zip(ingredients).map { (line, current) ->
            if (line.expectedVersion != current.version) throw Problem(409, "inventory_conflict", "Stock changed after this count was started. Reload and review every physical quantity before submitting a new count.")
            StockCountLine(current.id, current.name, current.unit, current.version, current.balanceMilli, line.countedMilli, line.countedMilli - current.balanceMilli)
        }
        connection.prepareStatement("INSERT INTO stock_counts(id,fingerprint,reason,actor_id,lines) VALUES(?,?,?,?,?::jsonb)").use {
            it.setObject(1, id); it.setString(2, fingerprint); it.setString(3, reason); it.setObject(4, stockId(actor)); it.setString(5, json.encodeToString(lines)); it.executeUpdate()
        }
        inputs.zip(ingredients).forEach { (line, current) -> inventory.reconcileCount(connection, current, line.countedMilli, actor, reason, id) }
        audit(connection, actor, "STOCK_COUNT_RECORDED", id.toString())
        find(connection, id)
    }
    fun get(id: String): StockCount = source.connection.use { find(it, stockId(id)) }
    fun list(before: Long?, limit: Int): StockCountPage {
        checkInput(limit in 1..100 && (before == null || before > 0), "Invalid stock count history page.")
        return source.connection.use { connection ->
            connection.prepareStatement("SELECT * FROM stock_counts${if (before == null) "" else " WHERE sequence<?"} ORDER BY sequence DESC LIMIT ?").use {
                var index = 1; if (before != null) it.setLong(index++, before); it.setInt(index, limit + 1)
                it.executeQuery().use { rows ->
                    val all = buildList { while (rows.next()) add(decode(rows)) }; val visible = all.take(limit)
                    StockCountPage(visible, if (all.size > limit) visible.last().sequence else null)
                }
            }
        }
    }
    private fun find(connection: Connection, id: UUID): StockCount = connection.prepareStatement("SELECT * FROM stock_counts WHERE id=?").use {
        it.setObject(1, id); it.executeQuery().use { rows -> if (rows.next()) decode(rows) else throw Problem(404, "stock_count_not_found", "Stock count not found.") }
    }
    private fun decode(rows: ResultSet) = StockCount(rows.getObject("id").toString(), rows.getLong("sequence").toString(), rows.getString("reason"),
        rows.getObject("actor_id").toString(), rows.getTimestamp("created_at").toInstant().toString(), json.decodeFromString(rows.getString("lines")))
}
