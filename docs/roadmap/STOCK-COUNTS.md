# Physical stock reconciliation — connected increment

Continuation of the user's 2026-10-18 direction to build the operational workflows before deciding plan packaging. Parent inventory source: `2811b31`; branch: `feat/stock-reconciliation`. Supplier purchase orders, bills and outstanding balances follow this bounded increment, not claimed delivered here.

## Journey and policy

Owner/manager loads ingredient balances → selects ingredients and enters nonnegative physical quantities in fixed G/ML/EACH units → reviews recorded/count/variance and explains the count → confirms → one immutable count and its nonzero reconciliation movements commit together → inventory, low-stock warnings and subsequent food submissions use the corrected balances.

- A count has a client UUID, required printable reason (1–200 characters), 1–100 unique ingredient lines, observed ingredient versions and counted integer-thousandth quantities from zero through STOCK_LIMIT. No implicit unit conversion, negative physical quantities or direct balance replacement endpoint.
- Snapshot ingredient name/unit, observed version, recorded quantity, counted quantity and signed variance. Persist actor/time and a monotonically paginated sequence. Do not recompute historical variances from live stock.
- Use the inventory transaction lock shared with manual movements and accepted food submissions. Any stale line rejects the whole count with 409 before any correction. The user must reload and recount/review; never automatically rebase a previously typed count.
- Canonicalize line order for request identity. Exact concurrent command retries return the original count before checking live versions. Reusing the UUID for another intent returns 409. A zero-variance count still records the observation but creates no zero movement or balance/version update.
- Each nonzero variance is an immutable COUNT movement linked to its count. A variance may span negative recorded stock to positive physical stock (up to twice STOCK_LIMIT); the resulting balance must remain within stock bounds. Counts do not change historical order/recipe snapshots, payments or sales.
- Owner/manager use existing STOCK_READ/STOCK_MANAGE permissions. Cashier/kitchen are denied reads, writes and lookup, including retries. Tenant routing and separate databases apply unchanged.
- No scheduling, approvals, blind counting, inventory valuation, stocktake freeze, supplier accounts, refunds or automatic stock returns in this increment. A count is a point-in-time correction: staff must coordinate physical counting with service; the software cannot infer when ingredients were physically used.

## Public interface (existing agreed HTTP/browser test seams)

`POST /inventory/counts`: `{id, reason, lines:[{ingredientId, expectedVersion, countedMilli}]}` → count `{id, sequence, reason, actorId, createdAt, lines:[{ingredientId, ingredientName, unit, observedVersion, recordedMilli, countedMilli, varianceMilli}]}`.

`GET /inventory/counts?limit=25&before={sequence}` → `{counts, nextCursor}`. `GET /inventory/counts/{id}` retrieves a known ID for uncertain-outcome recovery. Movement projection adds nullable `stockCountId`; old movements retain null.

## Implementation and verification checklist

- [ ] HTTP red → green: record a 500 g → 450 g count, immutable evidence and −50 g linked movement; zero variance records without a movement.
- [ ] HTTP red → green: concurrent replay, changed intent, stale multi-line atomic rejection, live submission/count races, quantity bounds and role/tenant isolation.
- [ ] Connect a focused `StockCountsView.tsx` to inventory; retain exact pending commands in business-scoped session storage, show review/confirmation and count history, require explicit reload after stale stock.
- [ ] Extend real backup/restore assertions with saved count evidence, linked movements and deduplicated replay after restore. Preserve the existing negative-stock fixture and upgrade drill.
- [ ] REA desktop + 390px count entry/review/confirmation/history; inspect screenshots. Run full HTTP/tenant/restore/upgrade/browser gate using explicit host-offline backend build if TLS restrictions persist.
- [ ] Update API/product/state evidence; make small verified commits. No merge, push, environment promotion or development/staging restart.

## Files and responsibilities

- `backend/.../StockCounts.kt`: count transport models, validation, command deduplication, immutable count persistence/read paging. Reuse internal inventory transaction/ingredient/correction helpers rather than duplicate balance rules.
- `backend/.../Inventory.kt` and `InventoryModels.kt`: narrowly scoped internal ledger support and count movement link.
- `backend/.../db/migration/V8__stock_counts.sql`: additive count storage and movement link/constraints; no edits to V1–V7.
- `backend/.../Main.kt`, `Tenants.kt`: tenant-local count module and guarded routes.
- `web/src/StockCountsView.tsx`, `inventory.ts`, `inventory.css`, `InventoryView.tsx`: dedicated count workspace within inventory, exact quantities and recovery.
- `verification/stock-counts.test.mjs`: public HTTP behavior. `backup-roundtrip.mjs`, `recovery.test.mjs`, `browser.mjs`, `rea-stock-counts.json`: recovery and observed browser workflow.
