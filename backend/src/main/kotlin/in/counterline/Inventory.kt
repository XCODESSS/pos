package `in`.counterline

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.security.MessageDigest
import java.sql.Connection
import java.sql.ResultSet
import java.util.UUID
import javax.sql.DataSource

/** Tenant-local stock ledger. Balances change only alongside attributable immutable movements. */
class Inventory(private val source: DataSource, private val json: Json) {
    private fun lock(connection: Connection) {
        connection.prepareStatement("SELECT pg_advisory_xact_lock(27418,6)").use { it.execute() }
    }
    private fun <T> transaction(action: (Connection) -> T): T = databaseTransaction(source) { connection -> lock(connection); action(connection) }
    private fun fingerprint(value: String) = MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString("") { "%02x".format(it) }
    private fun conflict(message: String): Nothing = throw Problem(409, "inventory_conflict", message)

    fun summary(): InventorySummary = source.connection.use { connection ->
        connection.createStatement().use { statement -> statement.executeQuery("SELECT * FROM ingredients ORDER BY lower(name),id").use { rows ->
            InventorySummary(buildList { while (rows.next()) add(decodeIngredient(rows)) })
        } }
    }
    fun create(input: IngredientCreate, actor: String): Ingredient = transaction { connection ->
        val id = stockId(input.id); val body = input.copy(name = stockText(input.name, "Ingredient name", 80))
        checkInput(body.lowStockMilli in 0..STOCK_LIMIT, "Invalid low-stock threshold.")
        val fingerprint = fingerprint(json.encodeToString(body))
        connection.prepareStatement("SELECT * FROM ingredients WHERE id=?").use {
            it.setObject(1, id); it.executeQuery().use { rows -> if (rows.next()) {
                if (rows.getString("create_fingerprint") != fingerprint) conflict("This ingredient ID belongs to a different creation request.")
                return@transaction decodeIngredient(rows)
            } }
        }
        val count = connection.createStatement().use { it.executeQuery("SELECT COUNT(*) FROM ingredients").use { rows -> rows.next(); rows.getInt(1) } }
        checkInput(count < 500, "The current outlet supports at most 500 ingredients.")
        uniqueName(connection, id, body.name)
        connection.prepareStatement("INSERT INTO ingredients(id,name,unit,low_stock_milli,create_fingerprint) VALUES(?,?,?,?,?)").use {
            it.setObject(1, id); it.setString(2, body.name); it.setString(3, body.unit.name); it.setLong(4, body.lowStockMilli); it.setString(5, fingerprint); it.executeUpdate()
        }
        audit(connection, actor, "INGREDIENT_CREATED", body.id)
        ingredient(connection, id)
    }
    fun change(id: String, input: IngredientChange, actor: String): Ingredient = transaction { connection ->
        val key = stockId(id); stockVersion(input.expectedVersion)
        val name = stockText(input.name, "Ingredient name", 80)
        checkInput(input.lowStockMilli in 0..STOCK_LIMIT, "Invalid low-stock threshold.")
        val current = ingredient(connection, key)
        if (current.version == input.expectedVersion + 1 && current.name == name && current.lowStockMilli == input.lowStockMilli) return@transaction current
        if (current.version != input.expectedVersion) conflict("Ingredient or stock changed elsewhere. Refresh before editing.")
        uniqueName(connection, key, name)
        connection.prepareStatement("UPDATE ingredients SET name=?,low_stock_milli=?,version=version+1 WHERE id=?").use {
            it.setString(1, name); it.setLong(2, input.lowStockMilli); it.setObject(3, key); it.executeUpdate()
        }
        audit(connection, actor, "INGREDIENT_UPDATED", id)
        ingredient(connection, key)
    }
    fun move(id: String, input: StockMove, actor: String): StockMoveResult = transaction { connection ->
        val key = stockId(id); val command = stockId(input.id)
        val body = input.copy(reason = stockText(input.reason, "Reason", 200), reference = input.reference?.trim()?.takeIf { it.isNotEmpty() })
        checkInput(body.reference == null || (body.reference.length <= 80 && body.reference.none(Char::isISOControl)), "Reference must have at most 80 printable characters.")
        stockVersion(body.expectedVersion)
        checkInput(body.quantityMilli in -STOCK_LIMIT..STOCK_LIMIT && body.quantityMilli != 0L, "Quantity must be nonzero and within the supported range.")
        checkInput(body.kind == ManualStockKind.ADJUSTMENT || body.quantityMilli > 0, "Receiving/waste quantities must be positive.")
        val fingerprint = fingerprint("$id:" + json.encodeToString(body))
        connection.prepareStatement("SELECT * FROM stock_movements WHERE command_id=?").use {
            it.setObject(1, command); it.executeQuery().use { rows -> if (rows.next()) {
                if (rows.getString("fingerprint") != fingerprint) conflict("This stock command ID belongs to a different intent.")
                return@transaction StockMoveResult(ingredient(connection, key), decodeMovement(rows))
            } }
        }
        val current = ingredient(connection, key)
        if (current.version != body.expectedVersion) conflict("Stock changed elsewhere. Refresh and review the movement before retrying.")
        val delta = if (body.kind == ManualStockKind.WASTE) -body.quantityMilli else body.quantityMilli
        val updated = applyDelta(connection, current, delta)
        val movement = appendMovement(connection, current, body.kind.name, delta, updated.balanceMilli, actor, body.reason, body.reference, command, fingerprint)
        audit(connection, actor, "STOCK_${body.kind}", id)
        StockMoveResult(updated, movement)
    }
    fun movements(id: String, before: Long?, limit: Int): StockMovementPage {
        val key = stockId(id)
        checkInput(limit in 1..100 && (before == null || before > 0), "Invalid stock-history page.")
        return source.connection.use { connection ->
            ingredient(connection, key)
            connection.prepareStatement("SELECT * FROM stock_movements WHERE ingredient_id=?${if (before == null) "" else " AND sequence<?"} ORDER BY sequence DESC LIMIT ?").use {
                it.setObject(1, key); var index = 2
                if (before != null) it.setLong(index++, before)
                it.setInt(index, limit + 1)
                it.executeQuery().use { rows ->
                    val all = buildList { while (rows.next()) add(decodeMovement(rows)) }
                    val visible = all.take(limit)
                    StockMovementPage(visible, if (all.size > limit) visible.last().sequence else null)
                }
            }
        }
    }
    fun recipe(input: RecipeTarget, version: Long?): Recipe = source.connection.use { connection ->
        val target = input.validated()
        checkInput(version == null || version > 0, "Invalid recipe version.")
        findRecipe(connection, target, version) ?: if (version == null) {
            menuItem(connection, target.itemId)
            Recipe(target.itemId, target.kind, target.choiceId, 0, emptyList())
        } else throw Problem(404, "recipe_not_found", "Recipe version not found.")
    }
    fun saveRecipe(input: RecipeWrite, actor: String): Recipe = transaction { connection ->
        val target = RecipeTarget(input.itemId, input.kind, input.choiceId).validated()
        stockVersion(input.expectedVersion)
        checkInput(input.components.size <= 40 && input.components.map { it.ingredientId }.distinct().size == input.components.size, "Use at most 40 unique ingredients per recipe.")
        val components = input.components.map {
            stockId(it.ingredientId); checkInput(it.quantityMilli in 1..1_000_000_000L, "Recipe quantities must be positive and at most 1,000,000 base units per serving."); it
        }.sortedBy { it.ingredientId }
        val menu = menuItem(connection, target.itemId)
        checkInput(when (target.kind) {
            RecipeKind.BASE -> true
            RecipeKind.VARIANT -> menu.variants.any { it.id == target.choiceId }
            RecipeKind.ADDON -> menu.addons.any { it.id == target.choiceId }
        }, "Recipe choice does not belong to this dish.")
        val ingredients = ingredientMap(connection)
        components.forEach { if (it.ingredientId !in ingredients) throw Problem(404, "ingredient_not_found", "A recipe ingredient was not found.") }
        val current = findRecipe(connection, target)
        if (current?.version == input.expectedVersion + 1 && current.components == components) return@transaction current
        if ((current?.version ?: 0L) != input.expectedVersion) conflict("Recipe changed elsewhere. Refresh before saving.")
        connection.prepareStatement("INSERT INTO recipe_versions(item_id,kind,choice_key,version,components,updated_by) VALUES(?,?,?,?,?::jsonb,?)").use {
            it.setString(1, target.itemId); it.setString(2, target.kind.name); it.setString(3, target.choiceId.orEmpty()); it.setLong(4, input.expectedVersion + 1)
            it.setString(5, json.encodeToString(components)); it.setObject(6, stockId(actor)); it.executeUpdate()
        }
        audit(connection, actor, "RECIPE_VERSION_SAVED", target.key())
        findRecipe(connection, target) ?: error("Saved recipe missing")
    }
    fun preview(input: StockPreview): StockSnapshot = transaction { connection ->
        val lines = CreateOrder(UUID.randomUUID().toString(), input.lines).validated().lines
        val menu = connection.createStatement().use { it.executeQuery("SELECT * FROM menu_items WHERE available").use { rows ->
            buildList { while (rows.next()) add(readMenu(rows, json)) }.associateBy { it.id }
        } }
        lines.forEach { line -> pricedLine(menu[line.itemId] ?: throw Problem(400, "unavailable_item", "A selected menu item is unavailable."), line) }
        calculate(connection, lines, menu)
    }
    internal fun consume(connection: Connection, orderId: UUID, lines: List<CartLine>, menu: Map<String, MenuItem>, actor: String): StockSnapshot {
        lock(connection)
        val snapshot = calculate(connection, lines, menu)
        for (requirement in snapshot.requirements) {
            val current = ingredient(connection, stockId(requirement.ingredientId))
            val updated = applyDelta(connection, current, -requirement.quantityMilli)
            appendMovement(connection, current, "CONSUMPTION", -requirement.quantityMilli, updated.balanceMilli,
                actor, "Accepted kitchen submission", orderId = orderId)
        }
        connection.prepareStatement("INSERT INTO order_inventory(order_id,snapshot) VALUES(?,?::jsonb)").use {
            it.setObject(1, orderId); it.setString(2, json.encodeToString(snapshot)); it.executeUpdate()
        }
        audit(connection, actor, "STOCK_SUBMISSION_RECORDED", orderId.toString())
        return snapshot
    }
    private fun calculate(connection: Connection, lines: List<CartLine>, menu: Map<String, MenuItem>): StockSnapshot {
        val ingredients = ingredientMap(connection)
        val itemIds = connection.createArrayOf("text", lines.map { it.itemId }.distinct().toTypedArray())
        val recipes = try { connection.prepareStatement("SELECT DISTINCT ON(item_id,kind,choice_key) * FROM recipe_versions WHERE item_id=ANY(?) ORDER BY item_id,kind,choice_key,version DESC").use {
            it.setArray(1, itemIds); it.executeQuery().use { rows -> buildList { while (rows.next()) add(decodeRecipe(rows)) }.associateBy { RecipeTarget(it.itemId, it.kind, it.choiceId).key() } }
        } } finally { itemIds.free() }
        val required = linkedMapOf<String, Long>(); val gaps = linkedMapOf<String, RecipeGap>(); val uses = linkedMapOf<String, RecipeUse>()
        for (line in lines) {
            val item = menu.getValue(line.itemId)
            val primary = RecipeTarget(item.id, if (line.variantId == null) RecipeKind.BASE else RecipeKind.VARIANT, line.variantId)
            val targets = listOf(primary) + line.addonIds.map { RecipeTarget(item.id, RecipeKind.ADDON, it) }
            for (target in targets) {
                val recipe = recipes[target.key()]
                val label = item.name + when (target.kind) {
                    RecipeKind.BASE -> " (base)"
                    RecipeKind.VARIANT -> " · " + item.variants.first { it.id == target.choiceId }.name
                    RecipeKind.ADDON -> " + " + item.addons.first { it.id == target.choiceId }.name
                }
                if (recipe == null || recipe.components.isEmpty()) {
                    gaps[target.key()] = RecipeGap(target.itemId, target.kind, target.choiceId, label)
                    continue
                }
                val previous = uses[target.key()]?.servings ?: 0
                uses[target.key()] = RecipeUse(target.itemId, target.kind, target.choiceId, recipe.version, previous + line.quantity)
                for (component in recipe.components) {
                    val total = (required[component.ingredientId] ?: 0L) + component.quantityMilli * line.quantity
                    checkInput(total in 1..STOCK_LIMIT, "Submission ingredient quantity exceeds the supported numeric range.")
                    required[component.ingredientId] = total
                }
            }
        }
        val requirements = required.entries.sortedBy { it.key }.map { (id, quantity) ->
            val ingredient = ingredients[id] ?: error("Recipe ingredient missing")
            StockRequirement(id, ingredient.name, ingredient.unit, quantity)
        }
        val warnings = requirements.mapNotNull { requirement ->
            val available = ingredients.getValue(requirement.ingredientId).balanceMilli
            if (requirement.quantityMilli > available) StockShortage(requirement.ingredientId, requirement.name, requirement.unit, requirement.quantityMilli, available, requirement.quantityMilli - available) else null
        }
        return StockSnapshot(requirements, warnings, gaps.values.toList(), uses.values.toList())
    }
    private fun ingredientMap(connection: Connection): Map<String, Ingredient> = connection.createStatement().use { statement ->
        statement.executeQuery("SELECT * FROM ingredients").use { rows -> buildList { while (rows.next()) add(decodeIngredient(rows)) }.associateBy { it.id } }
    }
    private fun menuItem(connection: Connection, id: String): MenuItem = connection.prepareStatement("SELECT * FROM menu_items WHERE id=?").use {
        it.setString(1, id); it.executeQuery().use { rows -> if (rows.next()) readMenu(rows, json) else throw Problem(404, "menu_not_found", "Dish not found.") }
    }
    private fun findRecipe(connection: Connection, target: RecipeTarget, version: Long? = null): Recipe? = connection.prepareStatement(
        "SELECT * FROM recipe_versions WHERE item_id=? AND kind=? AND choice_key=?${if (version == null) " ORDER BY version DESC LIMIT 1" else " AND version=?"}",
    ).use {
        it.setString(1, target.itemId); it.setString(2, target.kind.name); it.setString(3, target.choiceId.orEmpty()); if (version != null) it.setLong(4, version)
        it.executeQuery().use { rows -> if (rows.next()) decodeRecipe(rows) else null }
    }
    private fun decodeRecipe(rows: ResultSet) = Recipe(rows.getString("item_id"), RecipeKind.valueOf(rows.getString("kind")), rows.getString("choice_key").takeIf { it.isNotEmpty() }, rows.getLong("version"),
        json.decodeFromString(rows.getString("components")), rows.getTimestamp("updated_at").toInstant().toString(), rows.getObject("updated_by").toString())

    private fun applyDelta(connection: Connection, current: Ingredient, delta: Long): Ingredient {
        val balance = current.balanceMilli + delta
        checkInput(balance in -STOCK_LIMIT..STOCK_LIMIT, "Resulting stock quantity exceeds the supported numeric range.")
        checkInput(current.version < Long.MAX_VALUE, "Inventory version limit reached.")
        connection.prepareStatement("UPDATE ingredients SET balance_milli=?,version=version+1 WHERE id=?").use {
            it.setLong(1, balance); it.setObject(2, stockId(current.id)); it.executeUpdate()
        }
        return current.copy(balanceMilli = balance, version = current.version + 1)
    }
    private fun appendMovement(connection: Connection, current: Ingredient, kind: String, delta: Long, balance: Long,
        actor: String, reason: String, reference: String? = null, command: UUID? = null, fingerprint: String? = null, orderId: UUID? = null): StockMovement =
        connection.prepareStatement("""
            INSERT INTO stock_movements(ingredient_id,ingredient_name,unit,kind,delta_milli,balance_milli,command_id,fingerprint,order_id,reason,reference_text,actor_id)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *
        """.trimIndent()).use {
            it.setObject(1, stockId(current.id)); it.setString(2, current.name); it.setString(3, current.unit.name); it.setString(4, kind)
            it.setLong(5, delta); it.setLong(6, balance); it.setObject(7, command); it.setString(8, fingerprint); it.setObject(9, orderId)
            it.setString(10, reason); it.setString(11, reference); it.setObject(12, stockId(actor))
            it.executeQuery().use { rows -> check(rows.next()); decodeMovement(rows) }
        }
    private fun ingredient(connection: Connection, id: UUID): Ingredient = connection.prepareStatement("SELECT * FROM ingredients WHERE id=?").use {
        it.setObject(1, id); it.executeQuery().use { rows -> if (rows.next()) decodeIngredient(rows) else throw Problem(404, "ingredient_not_found", "Ingredient not found.") }
    }
    private fun uniqueName(connection: Connection, id: UUID, name: String) {
        connection.prepareStatement("SELECT 1 FROM ingredients WHERE lower(name)=lower(?) AND id<>?").use {
            it.setString(1, name); it.setObject(2, id); it.executeQuery().use { rows -> if (rows.next()) conflict("An ingredient with that name already exists.") }
        }
    }
    private fun decodeIngredient(rows: ResultSet) = Ingredient(rows.getObject("id").toString(), rows.getString("name"), StockUnit.valueOf(rows.getString("unit")), rows.getLong("low_stock_milli"), rows.getLong("balance_milli"), rows.getLong("version"))
    private fun decodeMovement(rows: ResultSet) = StockMovement(rows.getLong("sequence").toString(), rows.getObject("ingredient_id").toString(), rows.getString("ingredient_name"), StockUnit.valueOf(rows.getString("unit")),
        rows.getString("kind"), rows.getLong("delta_milli"), rows.getLong("balance_milli"), rows.getObject("command_id")?.toString(), rows.getObject("order_id")?.toString(),
        rows.getString("reason"), rows.getString("reference_text"), rows.getObject("actor_id").toString(), rows.getTimestamp("created_at").toInstant().toString())
}
