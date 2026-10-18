# Counterline — integrated product delivery contract

## Outcome

One staff-facing restaurant product for India, delivered through web, Kotlin/Compose Android and SwiftUI iOS/iPadOS. It is not a collection of independent demo services. The same persisted restaurant data, identities, permissions and business rules must drive every client.

## Integrated operating journey

Owner signs in → sets up staff, menu and tables → cashier opens a running check → submits dishes to the kitchen → recipes consume stock exactly once → kitchen prepares and hands over food → cashier settles/splits the bill → loyalty and sales/shift reports reconcile with that settlement.

Offline operation remains required, after the online workflows are stable. Internet loss must never be confused with successful digital payment or successful synchronization.

## Delivery sequence (all requested; none silently dropped)

| Increment | Product outcome | Integration / evidence gate |
| --- | --- | --- |
| 1. Identity + catalog | Individual staff, server-enforced roles, password/session lifecycle, usable staff and menu administration | Owner creates staff/dish → cashier uses dish in real persisted checkout → kitchen-only account prepares it → owner sees settlement; old receipts retain old prices |
| 2. Front desk | Floor/table setup, running checks, transfers, additions, split settlements | Multiple KOT batches belong to a running check; no duplicated dishes, tax, stock or cash; tables released by an explicit policy |
| 3. Inventory | Ingredients, units, recipes, receiving/purchasing, wastage, low-stock visibility | Orders consume recipe quantities exactly once; adjustments/reversals are recorded and reconcile with stock movement history |
| 4. Business control | Expenses, cash shifts/closing and useful business reports | Cash received, change, refunds/void policy and expenses reconcile to a close; historical reports do not change when today's menu changes |
| 5. Customers + loyalty | Customer records, consent-aware visit history, points/offers | Benefits and earned points attach to real settlements, not abandoned drafts; retries do not duplicate points; reversal rules are explicit |
| 6. Offline continuity | Local orders, menu versions, durable outbox and guarded sync | Device identity, legal numbering, conflict policy, interrupted-sync and multi-device reconciliation demonstrated |
| 7. Cross-platform / pilot | Web, native Android, native iOS/iPadOS parity and operational release gates | Real phones, hardware, backup/restore, permissions, tax/accounting validation, observability, accessibility and failure recovery verified |

These are connected increments of one product, not permission to declare a scaffold complete. The initial immutable-order demo needs a proper running-check model before supporting table additions/splits; do not bolt those onto paid bill snapshots or rewrite historical receipts.

## Current delivery state — 2026-10-18

- Verified connected web core: individual staff/permissions → base menu administration → ordering → price-free role-limited KDS → cash settlement → gross daily sales. A real browser completed owner staff/dish creation, cashier ordering, kitchen preparation, cashier resumption and settlement. The packaged Compose application is built and running with DB readiness, not just isolated development endpoints.
- Catalog choices and floor/table/running-check operations, additional batches, transfers and amount-based cash splits are implemented and have real HTTP + REA browser evidence. Multi-tenant SaaS is confirmed; explicit tenant routes, separate business databases, tenant-scoped sessions/journals and environment identity binding are verified against two isolated businesses. This does not implement multiple outlets per business or a hosted SaaS control plane.
- Ingredient stock, versioned recipes, manual receiving/waste/adjustments, traceable exactly-once consumption and warning-only shortages now connect to accepted orders/check batches. Current stock and historical submission facts remain separate; negative stock is visible. Public/REA/upgrade/restore evidence is recorded in the current state file.
- Physical stock counts now connect reviewed recorded/count/variance quantities to atomic, attributable ledger corrections. Stale counts reject without overwriting newer service/deliveries; exact retries and immutable count recovery are verified through HTTP, restore and desktop/narrow browser flows.
- Supplier directory → quantity purchase order → partial deliveries → explicitly closed unreceived remainder now connects to the same ledger, with immutable receipts, version checks and exact retry/recovery. This tracks physical quantities, not supplier prices, taxes or payable amounts.
- This is **not the completed product**. Supplier bills/payments, procurement pricing/returns, stock valuation/expiry/reversal policies, expenses/shift reconciliation/richer reports, customer loyalty, offline synchronization, multi-outlet authorization, native UI parity, tenant lifecycle/subscriptions and production security/tax/operations gates remain required.
- Native Kotlin/SwiftUI authentication sources follow the new contract, but both builds/device verification remain blocked by toolchains. Phones alone do not satisfy those release gates.
- The completed foundation provides isolated regression verification, a real restore drill and a separate local staging/release path. The inventory increment extends stock/revision history and preserves the same tenant/transaction safeguards; financial/loyalty ledgers remain next work. Existing receipts remain immutable. The first check payment locks additions; splits are amounts rather than guest/item allocation. Restaurant pilot policies need explicit validation.

## Release meaning

“Implemented” requires backend rules, migrations, usable screens, persistence, permission enforcement and error/recovery behavior. “Verified” requires observed evidence on the actual relevant client/platform. Missing native toolchains, provider contracts, credentials and accounting decisions remain explicit blockers, not fake integrations or success states.

The present application supports one outlet per explicitly registered business and remains a local development/staging preview until pilot gates are met. Multi-tenant onboarding/control-plane automation, app-store distribution, live digital payments and delivery-provider access must not be implied by local demos. The user separately authorized a local application Git repository and incremental commits; no remote/push, public deployment, external credentials provisioning, purchase or issue publishing is authorized merely by this document.

Current evidence and next work: `docs/roadmap/STATE.md`. Offline, India/INR and staff-only scope are confirmed user requirements.
