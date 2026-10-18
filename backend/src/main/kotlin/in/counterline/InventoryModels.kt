package `in`.counterline

import kotlinx.serialization.Serializable
import java.util.UUID

internal const val STOCK_LIMIT = 1_000_000_000_000L
internal fun stockId(value: String): UUID {
    val id = try { UUID.fromString(value) } catch (_: IllegalArgumentException) { throw Problem(400, "invalid_id", "Use a canonical ingredient/command UUID.") }
    checkInput(id.toString() == value, "Use a canonical ingredient/command UUID.")
    return id
}
internal fun stockText(value: String, label: String, maximum: Int): String = value.trim().also {
    checkInput(it.length in 1..maximum && it.none(Char::isISOControl), "$label must contain 1–$maximum printable characters.")
}
internal fun stockVersion(value: Long) = checkInput(value in 0 until Long.MAX_VALUE, "Invalid inventory version.")
@Serializable enum class StockUnit { G, ML, EACH }
@Serializable enum class ManualStockKind { RECEIPT, WASTE, ADJUSTMENT }
@Serializable data class IngredientCreate(val id: String, val name: String, val unit: StockUnit, val lowStockMilli: Long)
@Serializable data class IngredientChange(val expectedVersion: Long, val name: String, val lowStockMilli: Long)
@Serializable data class Ingredient(val id: String, val name: String, val unit: StockUnit, val lowStockMilli: Long, val balanceMilli: Long, val version: Long) {
    val lowStock: Boolean = balanceMilli <= lowStockMilli
}
@Serializable data class InventorySummary(val ingredients: List<Ingredient>)
@Serializable data class StockMove(
    val id: String, val kind: ManualStockKind, val quantityMilli: Long, val reason: String,
    val expectedVersion: Long, val reference: String? = null,
)
@Serializable data class StockMovement(
    val sequence: String, val ingredientId: String, val ingredientName: String, val unit: StockUnit,
    val kind: String, val deltaMilli: Long, val balanceMilli: Long, val commandId: String?, val orderId: String?,
    val reason: String, val reference: String?, val actorId: String, val createdAt: String, val stockCountId: String? = null, val purchaseReceiptId: String? = null,
)
@Serializable data class StockMoveResult(val ingredient: Ingredient, val movement: StockMovement)
@Serializable data class StockMovementPage(val movements: List<StockMovement>, val nextCursor: String?)

@Serializable enum class RecipeKind { BASE, VARIANT, ADDON }
@Serializable data class RecipeTarget(val itemId: String, val kind: RecipeKind, val choiceId: String? = null) {
    fun validated(): RecipeTarget {
        checkInput(Regex("[a-z0-9][a-z0-9-]{2,63}").matches(itemId), "Invalid recipe dish ID.")
        val choice = choiceId?.takeIf { it.isNotEmpty() }
        checkInput(if (kind == RecipeKind.BASE) choice == null else choice != null && Regex("[a-z0-9][a-z0-9-]{2,63}").matches(choice), "Choose the correct base/variant/add-on recipe target.")
        return copy(choiceId = choice)
    }
    fun key(): String = "$itemId|$kind|${choiceId.orEmpty()}"
}
@Serializable data class RecipeComponent(val ingredientId: String, val quantityMilli: Long)
@Serializable data class RecipeWrite(val itemId: String, val kind: RecipeKind, val expectedVersion: Long,
    val components: List<RecipeComponent>, val choiceId: String? = null)
@Serializable data class Recipe(val itemId: String, val kind: RecipeKind, val choiceId: String?, val version: Long,
    val components: List<RecipeComponent>, val updatedAt: String? = null, val updatedBy: String? = null)
@Serializable data class StockPreview(val lines: List<CartLine>)
@Serializable data class StockRequirement(val ingredientId: String, val name: String, val unit: StockUnit, val quantityMilli: Long)
@Serializable data class StockShortage(val ingredientId: String, val name: String, val unit: StockUnit,
    val requiredMilli: Long, val availableMilli: Long, val shortageMilli: Long)
@Serializable data class RecipeGap(val itemId: String, val kind: RecipeKind, val choiceId: String?, val label: String)
@Serializable data class RecipeUse(val itemId: String, val kind: RecipeKind, val choiceId: String?, val version: Long, val servings: Int)
@Serializable data class StockSnapshot(val requirements: List<StockRequirement>, val warnings: List<StockShortage>,
    val missingRecipes: List<RecipeGap>, val recipes: List<RecipeUse>)
