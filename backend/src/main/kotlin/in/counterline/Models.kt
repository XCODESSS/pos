package `in`.counterline

import kotlinx.serialization.Serializable
import java.math.BigDecimal
import java.math.RoundingMode
import java.util.UUID

@Serializable
data class MenuItem(
    val id: String, val name: String, val category: String, val pricePaise: Long,
    val cgstBps: Int, val sgstBps: Int, val vegetarian: Boolean,
    val available: Boolean = true, val version: Long = 0,
    val variants: List<MenuChoice> = emptyList(), val addons: List<MenuChoice> = emptyList(),
)

@Serializable
data class MenuChoice(val id: String, val name: String, val pricePaise: Long, val available: Boolean = true)

@OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)
@Serializable
data class CartLine(
    val itemId: String, val quantity: Int,
    @kotlinx.serialization.EncodeDefault(kotlinx.serialization.EncodeDefault.Mode.NEVER) val variantId: String? = null,
    @kotlinx.serialization.EncodeDefault(kotlinx.serialization.EncodeDefault.Mode.NEVER) val addonIds: List<String> = emptyList(),
) {
    fun key(): String = "$itemId|${variantId.orEmpty()}|${addonIds.sorted().joinToString(",")}"
}

@Serializable
enum class OrderType { TAKEAWAY, DINE_IN }

@OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)
@Serializable
data class CreateOrder(
    val id: String, val lines: List<CartLine>,
    val orderType: OrderType = OrderType.TAKEAWAY, val tableLabel: String? = null,
    @kotlinx.serialization.EncodeDefault(kotlinx.serialization.EncodeDefault.Mode.NEVER) val checkId: String? = null,
) {
    fun validated(): CreateOrder {
        val canonicalId = try { UUID.fromString(id).toString() } catch (_: IllegalArgumentException) {
            throw Problem(400, "invalid_id", "Order ID must be a UUID.")
        }
        checkInput(id.lowercase() == canonicalId, "Order ID must be a canonical UUID.")
        checkInput(lines.size in 1..50, "Choose between 1 and 50 menu items.")
        checkInput(lines.all { Regex("[a-z0-9][a-z0-9-]{2,63}").matches(it.itemId) &&
            (it.variantId == null || Regex("[a-z0-9][a-z0-9-]{2,63}").matches(it.variantId)) &&
            it.addonIds.size <= 20 && it.addonIds.distinct().size == it.addonIds.size &&
            it.addonIds.all { choice -> Regex("[a-z0-9][a-z0-9-]{2,63}").matches(choice) } }, "Invalid menu choices.")
        checkInput(lines.map { it.key() }.distinct().size == lines.size, "Combine duplicate dish configurations.")
        checkInput(lines.all { it.quantity in 1..99 }, "Item quantity must be between 1 and 99.")
        val table = tableLabel?.trim()?.takeIf { it.isNotEmpty() }
        checkInput(table == null || (table.length <= (if (checkId == null) 40 else 103) && table.none { it.isISOControl() }), "Invalid table label.")
        checkInput(orderType != OrderType.DINE_IN || table != null, "A table label is required for dine-in.")
        checkInput(orderType != OrderType.TAKEAWAY || table == null, "Takeaway orders cannot have a table label.")
        return copy(id = canonicalId, lines = lines.map { it.copy(addonIds = it.addonIds.sorted()) }.sortedWith(compareBy<CartLine> { it.itemId }.thenBy { it.key() }), tableLabel = table)
    }
}

@Serializable
data class BillLine(
    val itemId: String, val name: String, val quantity: Int, val unitPricePaise: Long,
    val cgstBps: Int, val sgstBps: Int, val subtotalPaise: Long,
    val cgstPaise: Long, val sgstPaise: Long,
)

@Serializable
data class Bill(
    val id: String, val billNumber: String, val createdAt: String, val orderType: OrderType,
    val tableLabel: String?, val lines: List<BillLine>, val subtotalPaise: Long,
    val cgstPaise: Long, val sgstPaise: Long, val totalPaise: Long,
    val currency: String = "INR", val demo: Boolean = true,
)

@Serializable
data class Order(
    val bill: Bill, val status: String, val paidAt: String?, val cashReceivedPaise: Long?,
    val kitchen: KitchenTicket?, val createdBy: String? = null, val paidBy: String? = null,
    val checkId: String? = null, val currentTableLabel: String? = null,
    val inventory: StockSnapshot? = null, val cashShiftId: String? = null,
)

@Serializable
enum class KitchenStatus {
    QUEUED, PREPARING, READY, SERVED;
    fun next(): KitchenStatus? = when (this) {
        QUEUED -> PREPARING
        PREPARING -> READY
        READY -> SERVED
        SERVED -> null
    }
}

@Serializable
data class KitchenTicket(val status: KitchenStatus, val version: Long, val updatedAt: String)

@Serializable
data class KitchenChange(val status: KitchenStatus, val expectedVersion: Long)

@Serializable
data class OrderPage(val orders: List<Order>, val nextCursor: String?)

@Serializable
data class KitchenLine(val itemId: String, val name: String, val quantity: Int)
@Serializable
data class KitchenBill(val id: String, val billNumber: String, val createdAt: String, val orderType: OrderType, val tableLabel: String?, val lines: List<KitchenLine>)
@Serializable
data class KitchenOrder(val bill: KitchenBill, val status: String, val kitchen: KitchenTicket?)
@Serializable
data class KitchenPage(val orders: List<KitchenOrder>, val nextCursor: String?)
fun Order.forKitchen() = KitchenOrder(KitchenBill(bill.id, bill.billNumber, bill.createdAt, bill.orderType,
    currentTableLabel ?: bill.tableLabel, bill.lines.map { KitchenLine(it.itemId, it.name, it.quantity) }), status, kitchen)

@Serializable
data class CashPayment(val receivedPaise: Long, val cashShiftId: String? = null)

@Serializable
data class SalesReport(val date: String, val timezone: String, val paidOrders: Long, val totalPaise: Long)

@Serializable
data class ErrorBody(val code: String, val message: String)

class Problem(val status: Int, val code: String, override val message: String) : RuntimeException(message)
fun checkInput(condition: Boolean, message: String) {
    if (!condition) throw Problem(400, "invalid_order", message)
}

// Exclusive pricing; round each line's CGST and SGST independently to the nearest paisa.
fun taxPaise(subtotal: Long, basisPoints: Int): Long = BigDecimal.valueOf(subtotal)
    .multiply(BigDecimal.valueOf(basisPoints.toLong()))
    .divide(BigDecimal(10000), 0, RoundingMode.HALF_UP).longValueExact()
