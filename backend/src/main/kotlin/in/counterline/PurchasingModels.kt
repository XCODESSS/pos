package `in`.counterline

import kotlinx.serialization.Serializable

@Serializable data class SupplierInput(val id: String, val name: String, val contact: String = "")
@Serializable data class Supplier(val id: String, val name: String, val contact: String, val actorId: String, val createdAt: String)
@Serializable data class SupplierList(val suppliers: List<Supplier>)
@Serializable data class PurchaseLineInput(val ingredientId: String, val quantityMilli: Long)
@Serializable data class PurchaseInput(val id: String, val supplierId: String, val reference: String, val lines: List<PurchaseLineInput>)
@Serializable data class PurchaseLine(val ingredientId: String, val ingredientName: String, val unit: StockUnit, val orderedMilli: Long, val receivedMilli: Long = 0)
@Serializable data class PurchaseOrder(val id: String, val sequence: String, val supplierId: String, val supplierName: String,
    val reference: String, val actorId: String, val createdAt: String, val version: Long, val status: String, val lines: List<PurchaseLine>,
    val closeReason: String?, val closedBy: String?, val closedAt: String?)
@Serializable data class PurchasePage(val orders: List<PurchaseOrder>, val nextCursor: String?)
@Serializable data class PurchaseDetail(val order: PurchaseOrder, val receipts: List<PurchaseReceipt>)
@Serializable data class PurchaseReceiveLine(val ingredientId: String, val expectedStockVersion: Long, val quantityMilli: Long)
@Serializable data class PurchaseReceive(val id: String, val expectedVersion: Long, val reference: String, val lines: List<PurchaseReceiveLine>)
@Serializable data class PurchaseReceiptLine(val ingredientId: String, val ingredientName: String, val unit: StockUnit, val quantityMilli: Long, val balanceMilli: Long)
@Serializable data class PurchaseReceipt(val id: String, val sequence: String, val purchaseOrderId: String, val reference: String,
    val actorId: String, val createdAt: String, val lines: List<PurchaseReceiptLine>)
@Serializable data class PurchaseClose(val id: String, val expectedVersion: Long, val reason: String)
