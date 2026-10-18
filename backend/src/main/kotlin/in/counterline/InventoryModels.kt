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
    val reason: String, val reference: String?, val actorId: String, val createdAt: String,
)
@Serializable data class StockMoveResult(val ingredient: Ingredient, val movement: StockMovement)
@Serializable data class StockMovementPage(val movements: List<StockMovement>, val nextCursor: String?)
