# Project state

Updated: 2026-10-18
Target: integrated staff-facing multi-tenant SaaS for India/INR, web + Kotlin Android + SwiftUI iOS/iPadOS
Current milestone: evolutionary prototype foundation
Status: local evolutionary-prototype foundation complete and verified; production/SaaS lifecycle gates remain open

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
- Clean source commit `9cb1e27` passed the complete HTTP/recovery/REA pipeline; the exact tested image objects were tagged locally as `counterline-backend:9cb1e27` and `counterline-web:9cb1e27`, with no rebuild/push. Release record: `verification/.artifacts/counterline-verify-5a4845fbdf0f/release.json`.
- Separate `staging` business `stage-demo` was verified healthy at `http://127.0.0.1:18088/t/stage-demo/`, with an empty menu, zero sales and independent generated credentials/volume. Owner/session persisted on restart; running image IDs exactly match the verified release. Generator overwrite was refused. Local evidence: `.local/staging-smoke.json`.
- Development was upgraded to those verified images without rebuilding or deleting its volume. Public before/after comparison preserves all 14 orders, 11 catalog records, two tables and 42,000 paise current-day sales; original owner credentials still work. Evidence: `.local/development-preservation.json`.
- A final harness review made Compose consume an explicit empty verification env file, preventing automatic development-dotenv loading. The complete nine-case HTTP/restore and identity/role probes passed again afterward (`counterline-verify-5cc0abcbbd76`).

## Current development runtime

Both development and staging Compose stacks, including their databases, were stopped at the user's request after validation. Containers, volumes and credentials are preserved. Development resumes at `http://127.0.0.1:8088/t/demo/` with ignored `.env`; staging resumes at `http://127.0.0.1:18088/t/stage-demo/` with separate ignored `.env.staging`. Both retain the exact application image objects verified from commit `9cb1e27`; later changes are verification-tooling/documentation only.

## Remaining product / release gates

- Inventory/recipes/receiving/purchasing/wastage; expenses/shifts/reconciliation; customer consent/loyalty; offline durable outbox, registered devices and synchronization.
- SaaS tenant lifecycle/subscriptions, large-fleet provisioning/migration/pooling, multi-outlet authorization and hosted deployment.
- Separate runtime/migrator DB privileges, TLS/ingress/proxy trust, secret rotation, MFA/recovery/idle policy, production monitoring, encrypted/off-host retention and measured recovery objectives, accounting/fiscal rules, security/load/accessibility and hardware validation.
- Complete native menu choices/check/admin/history/KDS workflows and real builds/devices. Android SDK and Mac/Xcode/signing remain unresolved. Native default tenant URL sources changed, but neither client is claimed built or device-tested.

## Next action

Shape the inventory/recipe increment around exactly-once consumption on accepted kitchen submissions, retaining tenant isolation and immutable historical facts. The user chose warning-only shortages (D-009): allow authorized continuation without manager approval and retain visible negative stock rather than blocking or hiding deficits. This policy is recorded, not yet implemented. Continue the separate hosted SaaS lifecycle/security/multi-outlet release gates before a public pilot. Current foundation branch remains unmerged with a clean worktree and no remote/push; CI is configured but unexecuted remotely.
