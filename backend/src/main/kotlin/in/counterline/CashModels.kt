package `in`.counterline

import kotlinx.serialization.Serializable

@Serializable data class CashOpen(val id: String, val openingPaise: Long, val reference: String)
@Serializable data class CashClose(val id: String, val expectedVersion: Long, val countedPaise: Long, val reason: String = "")
@Serializable data class CashShift(val id: String, val sequence: String, val status: String, val reference: String,
    val openingPaise: Long, val salesPaise: Long, val expensesPaise: Long, val supplierPaise: Long, val expectedPaise: Long,
    val version: Long, val openedBy: String, val openedAt: String, val countedPaise: Long?, val discrepancyPaise: Long?,
    val closeReason: String?, val closedBy: String?, val closedAt: String?)
@Serializable data class ActiveCashShift(val id: String, val sequence: String)
@Serializable data class CashShiftPage(val shifts: List<CashShift>, val nextCursor: String?)
@Serializable data class CashActive(val shift: ActiveCashShift?)
@Serializable enum class CashKind { SALE, CHECK_PAYMENT, EXPENSE, SUPPLIER_PAYMENT }
@Serializable data class CashMovement(val sequence: String, val cashShiftId: String, val kind: CashKind, val sourceId: String,
    val amountPaise: Long, val deltaPaise: Long, val balancePaise: Long, val actorId: String, val createdAt: String)
@Serializable data class CashMovementPage(val movements: List<CashMovement>, val nextCursor: String?)
