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

## NOW — inventory, physical counts and quantity purchasing verified

Spec `INVENTORY.md` and plan `../superpowers/plans/2026-10-18-inventory-recipes.md` deliver fixed-unit ingredients, receiving/waste/adjustment history, versioned recipes, exactly-once stock consumption on accepted food submissions and warning-only shortages. The backend/web increment has18 passing public acceptance cases, stock/money restore, a retained V5→V7 preservation rehearsal and six complete REA scenarios. New inventory setup/workflow/narrow captures have30/39/8 completed steps. Current evidence and build/native limits: `STATE.md` / `FINDINGS.md`.

The follow-on physical-count increment (`STOCK-COUNTS.md`) is verified on `feat/stock-reconciliation`, based on inventory:24 acceptance cases, V5→V8 upgrade/restore and nine REA scenarios. Counts have immutable variance evidence, linked corrections, stale/race protection and browser recovery. These branches are not automatically merged/promoted. Quantity purchasing (`PURCHASING.md`) now follows on `feat/supplier-purchasing`: supplier directory → purchase order → partial deliveries → closed unreceived remainder, backed by30 acceptance cases, V5→V9 preservation/restore and12 REA scenarios. Quantity commitments do not imply supplier prices/taxes/payable amounts. User development/staging stay stopped. Supplier bills/payments, procurement pricing/supplier edits/returns, stock valuation/expiry and explicit financial reversal policies remain open.

## NEXT — integrated online product and SaaS operating model

1. **Supplier bills and outstanding payments:** extend verified quantity purchasing with recorded supplier bills, partial payments and outstanding/overdue balances, without receiving stock twice. Set duplicate-reference/date/credit/void policies before implementation; never infer bill totals from quantity-only orders or advertise payment processing. Custom review schedules and final Base/Plus/Premium packaging remain deferred. Shape valuation/lot/expiry and cancellation/reversal policies explicitly; do not silently restore ingredients for a financial refund.
2. **Business control:** expenses, cash shifts/closing, reconciliation and useful sales/item/stock reports. Separate cash receipts from sales recognition; define immutable refund/credit-note policies.
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
- Prototype receipts, gross-sales totals and recorded cash are not fiscal invoices, a cash ledger or payment-provider confirmation.
- Offline/device and native hardware/toolchain requirements cannot be replaced by browser screenshots.
