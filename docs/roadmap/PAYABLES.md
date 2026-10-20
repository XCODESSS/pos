# Supplier bills and recorded payments

Continuation from `63cd2cd`; public HTTP and staff browser are the existing verification seams. Development/staging stay stopped; no promotion or push.

## Bounded policy

- Owner/manager explicitly receive PAYABLES_READ/PAYABLES_MANAGE. Cashiers and kitchen staff have no access.
- A supplier bill records an externally supplied total in integer INR paise (1–1,000,000,000,000), a supplier-scoped reference, bill date and due date. It optionally links to one purchase order belonging to that supplier. Multiple bills can link to an order; quantities never imply prices or money owed. No stock writes.
- References are trimmed, whitespace collapsed and case-insensitively unique per supplier across all years, including void bills. A corrected replacement must use an explicitly different reference. No silent duplicate acceptance with a new ID.
- Dates are strict YYYY-MM-DD, 2000–2099. Bill date cannot be future relative to Asia/Kolkata; due date must be on/after bill date. Overdue means positive outstanding and due date before the server's current India date; due today is not overdue.
- Partial payments are staff assertions of payments already made, not gateway processing. Record positive amount no greater than outstanding, payment date (bill date through today), CASH/BANK_TRANSFER/UPI/OTHER method, and required evidence/reference. Attribution and timestamp are immutable. These do not affect customer sales or a cash shift (shift accounting is not implemented).
- This bounded preview supports at most 100 payment records per bill; the 100th must settle the balance. The screen warns before that last slot. Never record a larger payment than actually made; higher-installment workflows require a later limit/history design.
- Bill amount/reference/link/dates are immutable. Only an unpaid bill can be explicitly voided, with reason and actor. Void retains evidence and reference reservation; no financial/stock reversal. Paid bills cannot be voided. Credits, refunds, payment correction/reversal, advance payments and automatic fiscal/tax/valuation accounting are unsupported and must not be approximated by deletion or negative payments. This bounded development policy needs pilot validation.
- Creation/payment/void use client UUIDs and normalized fingerprints. Exact retries recover existing evidence before state/version checks. Changed intent conflicts. Payment/void require the observed version; concurrent commands have one winner. No automatic stale-version rebasing.
- Bill detail includes immutable payment history; keyset-paginated list includes outstanding/overdue. Summary reports all suppliers' current outstanding/overdue totals and open bill counts, not merely the current page. All reads/writes are tenant-local; aggregate reads and writes share a payable transaction lock.
- Web: supplier selection, reviewed bill/payment/void, balance overview, history/ID lookup, business-scoped exact pending-command recovery and explicit stale reload. Quantity purchasing remains separate.

## Verification

Vertical HTTP slices: create/recover without stock or sales mutation; partial/final payment; duplicate references/replay; stale/overpayment/invalid dates/amounts; unpaid void; roles and tenants; history/summary. Extend restore verification and browser workflows, then run existing upgrade/restore and regression gates. Native parity remains unverified.
