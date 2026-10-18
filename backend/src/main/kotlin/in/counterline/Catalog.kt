package `in`.counterline

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.security.MessageDigest
import java.sql.PreparedStatement
import java.sql.ResultSet
import javax.sql.DataSource

@OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)
@Serializable
data class MenuWrite(
    val name: String, val category: String, val pricePaise: Long,
    val cgstBps: Int, val sgstBps: Int, val vegetarian: Boolean, val available: Boolean,
    @kotlinx.serialization.EncodeDefault(kotlinx.serialization.EncodeDefault.Mode.NEVER) val variants: List<MenuChoice> = emptyList(),
    @kotlinx.serialization.EncodeDefault(kotlinx.serialization.EncodeDefault.Mode.NEVER) val addons: List<MenuChoice> = emptyList(),
) {
    fun validated(): MenuWrite {
        val title = name.trim(); val group = category.trim()
        checkInput(title.length in 1..120 && title.none(Char::isISOControl), "Dish name must contain 1–120 printable characters.")
        checkInput(group.length in 1..60 && group.none(Char::isISOControl), "Category must contain 1–60 printable characters.")
        checkInput(pricePaise in 1..100_000_000L, "Price must be positive and at most INR 10 lakh.")
        checkInput(cgstBps == sgstBps && cgstBps in setOf(0, 250, 600, 900, 1400), "Choose a supported demo split GST rate: 0%, 5%, 12%, 18% or 28%.")
        return copy(name = title, category = group,
            variants = validateChoices(variants, variant = true), addons = validateChoices(addons, variant = false))
    }
    private fun validateChoices(values: List<MenuChoice>, variant: Boolean): List<MenuChoice> {
        checkInput(values.size <= 20 && values.map { it.id }.distinct().size == values.size, "Use at most 20 uniquely identified variants or add-ons.")
        return values.map {
            checkInput(Regex("[a-z0-9][a-z0-9-]{2,63}").matches(it.id), "Invalid choice ID.")
            val name = it.name.trim()
            checkInput(name.length in 1..60 && name.none(Char::isISOControl), "Choice names must contain 1–60 printable characters.")
            checkInput(it.pricePaise in (if (variant) 1L else 0L)..100_000_000L, "Invalid choice price.")
            it.copy(name = name)
        }
    }
    fun toMenu(id: String, version: Long) = MenuItem(id, name, category, pricePaise, cgstBps, sgstBps, vegetarian, available, version, variants, addons)
}
@Serializable data class MenuCreate(val id: String, val item: MenuWrite)
@Serializable data class MenuChange(val expectedVersion: Long, val item: MenuWrite)

internal fun readMenu(rows: ResultSet, json: Json) = MenuItem(
    rows.getString("id"), rows.getString("name"), rows.getString("category"), rows.getLong("price_paise"),
    rows.getInt("cgst_bps"), rows.getInt("sgst_bps"), rows.getBoolean("vegetarian"),
    rows.getBoolean("available"), rows.getLong("version"),
    json.decodeFromString(rows.getString("variants")), json.decodeFromString(rows.getString("addons")),
)

/** One authoritative price/description projection, shared by every order source. */
internal fun pricedLine(item: MenuItem, line: CartLine): BillLine {
    val variant = line.variantId?.let { id -> item.variants.find { it.id == id && it.available }
        ?: throw Problem(400, "unavailable_variant", "A selected variant is unavailable. Refresh the menu.") }
    checkInput(item.variants.isEmpty() || variant != null, "Choose a variant for ${item.name}.")
    val addons = line.addonIds.map { id -> item.addons.find { it.id == id && it.available }
        ?: throw Problem(400, "unavailable_addon", "A selected add-on is unavailable. Refresh the menu.") }
    val unitPrice = (variant?.pricePaise ?: item.pricePaise) + addons.sumOf { it.pricePaise }
    val description = item.name + (variant?.let { " · ${it.name}" } ?: "") + addons.joinToString("") { " + ${it.name}" }
    val subtotal = Math.multiplyExact(unitPrice, line.quantity.toLong())
    return BillLine(item.id, description, line.quantity, unitPrice, item.cgstBps, item.sgstBps,
        subtotal, taxPaise(subtotal, item.cgstBps), taxPaise(subtotal, item.sgstBps))
}

/** Catalog changes affect future orders only; existing bill snapshots remain authoritative. */
class Catalog(private val source: DataSource, private val json: Json) {
    fun all(): List<MenuItem> = source.connection.use { connection ->
        connection.createStatement().use { it.executeQuery("SELECT * FROM menu_items ORDER BY category, name").use { rows ->
            buildList { while (rows.next()) add(readMenu(rows, json)) }
        } }
    }
    fun create(input: MenuCreate, actor: String): MenuItem {
        checkInput(Regex("[a-z0-9][a-z0-9-]{2,63}").matches(input.id), "Dish ID must contain 3–64 lowercase letters, digits or hyphens.")
        val item = input.item.validated()
        val fingerprint = MessageDigest.getInstance("SHA-256").digest(json.encodeToString(item).toByteArray()).joinToString("") { "%02x".format(it) }
        return databaseTransaction(source) { connection ->
            connection.prepareStatement("""
                INSERT INTO menu_items(id,name,category,price_paise,cgst_bps,sgst_bps,vegetarian,available,variants,addons,create_fingerprint)
                VALUES (?,?,?,?,?,?,?,?,?::jsonb,?::jsonb,?) ON CONFLICT(id) DO NOTHING
            """.trimIndent()).use {
                it.setString(1, input.id); bind(it, item, 2); it.setString(11, fingerprint)
                if (it.executeUpdate() == 1) audit(connection, actor, "MENU_CREATED", input.id)
            }
            connection.prepareStatement("SELECT * FROM menu_items WHERE id = ?").use {
                it.setString(1, input.id); it.executeQuery().use { rows ->
                    check(rows.next())
                    if (rows.getString("create_fingerprint") != fingerprint) throw Problem(409, "menu_id_conflict", "This dish ID belongs to another creation request.")
                    readMenu(rows, json)
                }
            }
        }
    }
    fun change(id: String, input: MenuChange, actor: String): MenuItem = databaseTransaction(source) { connection ->
        val item = input.item.validated()
        checkInput(input.expectedVersion in 0 until Long.MAX_VALUE, "Invalid menu version.")
        val current = connection.prepareStatement("SELECT * FROM menu_items WHERE id = ? FOR UPDATE").use {
            it.setString(1, id); it.executeQuery().use { rows -> if (rows.next()) readMenu(rows, json) else throw Problem(404, "menu_not_found", "Dish not found.") }
        }
        if (current.version == input.expectedVersion + 1 && item.toMenu(id, current.version) == current) return@databaseTransaction current
        if (current.version != input.expectedVersion) throw Problem(409, "stale_menu", "Dish changed elsewhere. Refresh before editing.")
        connection.prepareStatement("UPDATE menu_items SET name=?,category=?,price_paise=?,cgst_bps=?,sgst_bps=?,vegetarian=?,available=?,variants=?::jsonb,addons=?::jsonb,version=version+1 WHERE id=?").use {
            bind(it, item, 1); it.setString(10, id); it.executeUpdate()
        }
        audit(connection, actor, "MENU_UPDATED", id)
        item.toMenu(id, current.version + 1)
    }
    private fun bind(statement: PreparedStatement, item: MenuWrite, first: Int) {
        statement.setString(first, item.name); statement.setString(first + 1, item.category); statement.setLong(first + 2, item.pricePaise)
        statement.setInt(first + 3, item.cgstBps); statement.setInt(first + 4, item.sgstBps); statement.setBoolean(first + 5, item.vegetarian); statement.setBoolean(first + 6, item.available)
        statement.setString(first + 7, json.encodeToString(item.variants)); statement.setString(first + 8, json.encodeToString(item.addons))
    }
}
