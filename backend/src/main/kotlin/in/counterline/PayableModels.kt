package `in`.counterline

import kotlinx.serialization.Serializable

@Serializable data class SupplierBillInput(val id: String, val supplierId: String, val reference: String,
    val billDate: String, val dueDate: String, val totalPaise: Long, val purchaseOrderId: String? = null)
@Serializable data class SupplierBill(val id: String, val sequence: String, val supplierId: String, val supplierName: String,
    val purchaseOrderId: String?, val reference: String, val billDate: String, val dueDate: String, val totalPaise: Long,
    val paidPaise: Long, val outstandingPaise: Long, val overdue: Boolean, val status: String, val version: Long,
    val actorId: String, val createdAt: String, val voidReason: String?, val voidedBy: String?, val voidedAt: String?)
@Serializable enum class SupplierPaymentMethod { CASH, BANK_TRANSFER, UPI, OTHER }
@OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)
@Serializable data class SupplierPaymentInput(val id: String, val expectedVersion: Long, val amountPaise: Long,
    val paymentDate: String, val method: SupplierPaymentMethod, val reference: String,
    @kotlinx.serialization.EncodeDefault(kotlinx.serialization.EncodeDefault.Mode.NEVER) val cashShiftId: String? = null)
@Serializable data class SupplierPayment(val id: String, val sequence: String, val billId: String, val amountPaise: Long,
    val paymentDate: String, val method: SupplierPaymentMethod, val reference: String, val actorId: String, val createdAt: String, val cashShiftId: String? = null)
@Serializable data class SupplierBillPage(val bills: List<SupplierBill>, val nextCursor: String?)
// Aggregate monetary values/counts are decimal strings: an unbounded history can exceed JS safe integers.
@Serializable data class SupplierBalance(val supplierId: String, val supplierName: String, val outstandingPaise: String, val overduePaise: String, val openBills: String)
@Serializable data class PayableSummary(val asOf: String, val timezone: String, val suppliers: List<SupplierBalance>)
@Serializable data class SupplierBillVoid(val id: String, val expectedVersion: Long, val reason: String)
@Serializable data class SupplierBillDetail(val bill: SupplierBill, val payments: List<SupplierPayment>)
