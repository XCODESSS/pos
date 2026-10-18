# Project state

Updated: 2026-10-18
Target: integrated staff-facing multi-tenant SaaS for India/INR, web + Kotlin Android + SwiftUI iOS/iPadOS
Current milestone: evolutionary prototype foundation
Status: tenant/environment isolation, automated HTTP and recovery gates, and REA browser flows pass locally; staging image-promotion smoke is next; not production-ready

## Scope and architecture

Independent restaurant businesses are separate tenants. The current shared backend uses explicitly registered database-per-tenant runtimes; each tenant currently has one outlet. No public signup, subscription control plane or multi-outlet memberships exist. Architecture trade-off: D-008. Full contract: `../../PRODUCT.md`. Foundation spec: `FOUNDATION.md`; execution plan: `../superpowers/plans/2026-10-18-evolutionary-prototype-foundation.md`.

## Working / observed in this milestone

- Application Git repository initialized at `D:/pet-pooja/pos`. Baseline `35a8d71` is on `main`; ongoing commits are on `feat/prototype-foundation`. No remote/push. Credentials, signing material, generated outputs and evidence remain ignored.
- Staff/catalog/order/KDS/cash core plus menu choices, tables/running checks, immutable kitchen rounds, transfer and amount-based splits build and run. First payment locks additions; complete settlement releases the table independently of kitchen state. Demo receipts are not fiscal invoices.
- `/t/{business-code}/api` selects a registered tenant database before authentication. Staff sessions and browser pending/draft/recovery keys are scoped by business. Global `/api` is absent. Two test businesses can reuse usernames, dish IDs and order UUIDs without sharing data/tokens/reports.
- V5 adds immutable tenant/environment database binding without editing V1–V4. Mismatched tenant/environment probes fail before listening. Fresh verification/staging catalogs exclude exact untouched V1 demo fixtures; populated unbound non-development databases are refused. Non-development roles are nonprivileged and distinct; a real role probe denies cross-database CONNECT.
- `node verification/run.mjs` passes nine public acceptance cases across fresh environment, pricing/snapshots/retries/concurrency, role denials/revocation, checks/transfers/splits, tenancy and restoration. Each run owns random credentials/ports and a separate Compose project/volume; development data is not mutated.
- Real `pg_dump` / restore into a new scratch database preserves a paid INR 156.98 receipt, two check payments INR 70 + INR 86.98, sales and persisted session facts. Recovery uses a proxy reload/readiness gate instead of restarting the web container and potentially changing its ephemeral host port.
- REA 6.5.0 observed 46 desktop steps, 9 narrow-screen receipt-recovery steps and 6 tenant-switch steps, including menu variants/add-ons, two KOT batches, preparation, transfer, cancel/confirm cash, final settlement and isolation of a seeded other-business journal. Screenshots were reviewed. Evidence: ignored `verification/.artifacts/counterline-verify-831c6cc63293/`; IDs in `FINDINGS.md`. Not physical phones/Safari/hardware.
- Host JDK/backend and TypeScript/web production builds succeed; npm audit reported zero known vulnerabilities on this run. CI is configured for host builds plus HTTP/tenant/restore checks, but no remote CI execution has occurred.
- Local staging config/secret generator and exact tested-image tagging are implemented. A clean-commit image promotion + separate staging startup/data-preservation smoke still needs to run before this milestone's final handoff.

## Current development runtime

The pre-foundation Compose images remain running against the original database on ports web 8088/backend 8080/DB54329 until the planned verified upgrade. Credentials remain in ignored `.env`; startup never resets an existing owner. Preserve and compare public bill/menu/report facts before/after upgrading. The new development route will be `/t/demo/`, not the old unscoped API.

## Remaining product / release gates

- Inventory/recipes/receiving/purchasing/wastage; expenses/shifts/reconciliation; customer consent/loyalty; offline durable outbox, registered devices and synchronization.
- SaaS tenant lifecycle/subscriptions, large-fleet provisioning/migration/pooling, multi-outlet authorization and hosted deployment.
- Separate runtime/migrator DB privileges, TLS/ingress/proxy trust, secret rotation, MFA/recovery/idle policy, production monitoring, encrypted/off-host retention and measured recovery objectives, accounting/fiscal rules, security/load/accessibility and hardware validation.
- Complete native menu choices/check/admin/history/KDS workflows and real builds/devices. Android SDK and Mac/Xcode/signing remain unresolved. Native default tenant URL sources changed, but neither client is claimed built or device-tested.

## Next action

Commit the operational foundation; run full HTTP/recovery/REA gates on that clean commit and tag the same tested images locally. Start independent synthetic staging, verify empty business state and preserved credentials on restart, then upgrade development with unchanged public records. Record final evidence and remaining gates; do not push or claim production readiness.
