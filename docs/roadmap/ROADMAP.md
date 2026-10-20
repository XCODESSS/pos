# Counterline — evolutionary multi-tenant SaaS roadmap

## Outcome and confirmed scope

One integrated staff-facing restaurant product for independent businesses in India/INR, delivered through web, Kotlin/Compose Android and SwiftUI iOS/iPadOS. The user confirmed **multi-tenant SaaS** on 2026-10-18 and requested an evolutionary prototype with a safe pre-production/production path. A tenant is a business; outlets are its locations. Full product contract: `../../PRODUCT.md`.

Offline remains required after stable online workflows. All requested inventory, business-control and loyalty capabilities remain in scope; this foundation milestone postpones their implementation, not their delivery. REA is a separate authorized observation tool, not the application framework or evidence of private Petpooja parity.

## Completed foundation — verified locally

Outcome: version-controlled, reproducibly verifiable software with cross-business isolation and a separately configured local staging/recovery path. Spec: `FOUNDATION.md`; executable tasks: `../superpowers/plans/2026-10-18-evolutionary-prototype-foundation.md`.

Current implementation: connected staff/catalog/order/KDS/cash flow, variants/add-ons, tables/running checks/multiple batches/transfers/amount-based cash splits. Public interfaces run against disposable PostgreSQL databases, not development data. A shared application routes explicitly to separate tenant databases. Database identity binds business + environment; non-development fresh catalogs exclude demo fixtures. Decision/trade-off: D-008.

Exit evidence:
- Honest Git baseline and small coherent local commits; no secret artifacts or push.
- Host/package builds and public-interface regression cases for prices, permissions, snapshots, retries/concurrency and check reconciliation.
- Two independent businesses reuse usernames/item IDs without token/data/report leakage; wrong tenant/environment startup refuses service.
- REA desktop flow, narrow-screen recovery and tenant-journal switching; observed results distinguished from physical-device checks.
- Real backup/restore into a fresh disposable database preserves receipts, splits, sales and session facts.
- The same verified image objects run against a separate, empty local staging database with distinct secrets; release/migration/rollback/recovery procedures are explicit.

Production is not the exit claim. Hosted TLS/monitoring, privileged-role separation, fiscal policy, tenancy lifecycle, native/toolchain and hardware gates remain open. Current evidence and any unfinished acceptance conditions: `STATE.md`.

## NOW — inventory, purchasing, payables and shared cash control verified

Spec `INVENTORY.md` and plan `../superpowers/plans/2026-10-18-inventory-recipes.md` deliver fixed-unit ingredients, receiving/waste/adjustment history, versioned recipes, exactly-once stock consumption on accepted food submissions and warning-only shortages. The backend/web increment has18 passing public acceptance cases, stock/money restore, a retained V5→V7 preservation rehearsal and six complete REA scenarios. New inventory setup/workflow/narrow captures have30/39/8 completed steps. Current evidence and build/native limits: `STATE.md` / `FINDINGS.md`.

The follow-on physical-count increment (`STOCK-COUNTS.md`) is verified on `feat/stock-reconciliation`, based on inventory:24 acceptance cases, V5→V8 upgrade/restore and nine REA scenarios. Counts have immutable variance evidence, linked corrections, stale/race protection and browser recovery. These branches are not automatically merged/promoted. Quantity purchasing (`PURCHASING.md`) now follows on `feat/supplier-purchasing`: supplier directory → purchase order → partial deliveries → closed unreceived remainder, backed by30 acceptance cases, V5→V9 preservation/restore and12 REA scenarios. Quantity commitments do not imply supplier prices/taxes/payable amounts. User development/staging stay stopped. Supplier bills/payments (`PAYABLES.md`) now continue on `feat/supplier-payables`: recorded INR totals, partial payments, outstanding/overdue balances and unpaid voiding, with38 acceptance cases and17 REA scenarios plus V5→V10 upgrade/restore. No stock duplication or payment processing. Procurement pricing/supplier edits/returns, stock valuation/expiry and financial credit/reversal policies remain open.

Shared-drawer/expense control (`CASH-CONTROL.md`) now follows on `feat/cash-control`. The user selected one shared drawer and mandatory open shifts for new cash. Backend/web links sale/change/check splits, operating cash expenses and supplier cash to attributable drawer movements; closing retains counted/expected cash and discrepancy reasons. Public race/replay/permission/tenant, upgrade/restore and browser gates pass; correction/refund/top-up and fiscal policies remain open. Current evidence: `STATE.md`.

## NEXT — integrated online product and SaaS operating model

1. **Supplier financial follow-through:** the bounded bill/payment increment is verified; credits, payment correction/reversal, advances, fiscal accounting and procurement pricing/returns still require explicit policies. Do not infer money from quantities or restore ingredients for a financial refund. Custom schedules and final Base/Plus/Premium packaging remain deferred.
2. **Business reports — next connected increment:** bounded date-range sales/item, expense and cash-reconciliation reports based on immutable snapshots/ledgers. Shared shifts/expenses/closing are verified; distinguish cash received from completed-check sales, noncash spending, opening float and supplier payments. No margin/profit calculation without cost/valuation data. Define financial correction/refund/credit-note policies separately.
3. **Customers and loyalty:** consent-aware records, benefits and points tied to real settlements with safe retries/reversal rules.
4. **SaaS lifecycle and outlets:** approved tenant provisioning/offboarding, subscription/access policy, configuration/backup/migration fleet operations and multi-outlet memberships/permissions. Current database isolation is not onboarding automation. Decide pilot scale and capacity before increasing the bounded tenant registry.

Each increment includes persistence, migrations, permissions, actual staff UI, recovery and regression evidence. Extend the existing operating journey instead of creating disconnected CRUD demonstrations. Native parity remains a tracked requirement, not a web-only redefinition.

## REQUIRED AFTER STABLE ONLINE — offline continuity

Registered outlet/device identity, versioned menu/tax/recipe facts, durable local command outbox, interrupted-sync and conflict handling, legal numbering and multi-device reconciliation. Distinguish internet loss from local-network loss. Never infer digital-payment success from a device assertion or network failure.

## Pre-production to pilot release gates

- Separate migration/runtime database privileges, hosted HTTPS/ingress/proxy trust, secret rotation, identity recovery/MFA/idle decisions, security/isolation-abuse and load review.
- Monitoring/alerts, audit access policy, encrypted off-host backups/retention, measured restore objectives, incident/support and migration/rollback rehearsals. Readiness checks alone do not satisfy observability.
- Tax/accounting validation for India GST, fiscal numbering, refunds/credit notes and historical reconciliation. Configurable demo tax is not compliance.
- Successful Android/iOS builds, complete native workflows, real phones, printers/drawers, accessibility and failure recovery. Android SDK configuration and Mac/Xcode/signing are unresolved prerequisites.
- A bounded pilot scope and explicit fallback/reconciliation process. No public deployment, provider access, app signing or live cash is implied by local verification.

## Major risks

- Database-per-tenant simplifies current isolation but adds provisioning, backup, migration and connection overhead. Large fleets need a reviewed control plane/pooling strategy; shared-schema migration is not an invisible implementation detail.
- Single-outlet role models do not automatically become multi-outlet memberships.
- Current exact amount splits are not guest/item allocation; adding dishes after settlement starts is deliberately disallowed.
- Prototype receipts and gross-sales totals are not fiscal invoices. The shared-drawer movement ledger is not bank reconciliation, fiscal accounting or payment-provider confirmation.
- Offline/device and native hardware/toolchain requirements cannot be replaced by browser screenshots.
