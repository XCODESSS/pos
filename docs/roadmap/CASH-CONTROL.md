# Expenses and shared cash drawer

User accepted one shared drawer per outlet and an open shift required for cash transactions. Continue `bdb73a4`; existing public HTTP/browser seams, disposable verification only. No development/staging promotion.

## Contract

- Owner/manager open/close shifts and record operating expenses. Cashiers can read the active shift identity and record sales but cannot see drawer totals, expenses, or close/open. Kitchen cannot access cash control.
- One OPEN shift per tenant's current single outlet, no per-cashier drawers. Opening float is a physical count, not sales. No automatic carry-forward: next opening is explicitly counted, not inferred from the prior expected/count.
- Expected cash = opening float + standalone sale totals (cash tender minus change) + each running-check split when actually received − CASH operating expenses − CASH supplier payments. Check completion does not post batches again. Noncash payments/expenses do not touch the drawer. Supplier payments are not also operating expenses.
- Every new cash operation requires an explicitly observed `cashShiftId`. Closed/missing/wrong shift rejects atomically; retained commands are never moved automatically to a newer shift. Exact historical retries remain valid even with no open shift. No backfill of pre-migration money into shifts.
- Opening/closing/expenses use UUID identity and normalized fingerprints. Close requires the observed shift version; every drawer movement increments it. A receipt racing close either commits before and makes close stale, or close wins and the receipt fails. Closed snapshots are immutable, no reopen/edit/delete. Counted cash is nonnegative; discrepancy = counted − expected, with a mandatory reason for a nonzero discrepancy. Negative expected cash remains visible as a reconciliation problem, not clamped or treated as a bank overdraft.
- Individual amounts and shift running totals are bounded to safe integer paise (absolute totals ≤1e12). History is keyset paginated. Open/close/expense/movement/audit commit atomically; module locks are acquired before cash lock, and cash control never acquires other module locks.
- Expenses are immediate operating spending, not purchases of tracked stock, supplier bill payments or unpaid liabilities. Required payee/category/reference, date and amount; CASH/BANK_TRANSFER/UPI/OTHER method. No supplier-payment ID accepted. Cash outflows use today's India date and the selected active drawer; noncash expenses may be historical (2000 through today). Cash supplier payments now also require today's India date. Old evidence/retries are unchanged.
- Expense and supplier-payment corrections/refunds, cash deposits/withdrawals/top-ups, fiscal accounting and profit reports are not implemented here. Do not fake corrections with negative spending, voiding a paid bill, or editing a closed shift. Discrepancies explain the count; they do not rewrite sales or expense evidence.
- Screens: review opening float, expense and closure; live shift summary, paginated movements/shift/expense history; known-ID recovery; business-scoped exact pending journals; explicit stale reload. Cash checkout and supplier-payment reviews capture the current shift ID before submission.

## Verification

HTTP vertical slices: opening/replay/one drawer; cash sale/check split/change; cash/noncash supplier outflow; cash/noncash expense; expected/count/discrepancy; stale races and retry across close/new shift; roles, tenants, numeric rollback and history. Extend restore, legacy upgrade and REA desktop/narrow/stale/journal isolation gates. Native parity remains a separate gate.
