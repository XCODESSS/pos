# Project state

Updated: 2026-10-18
Target: integrated staff-facing multi-tenant SaaS for India/INR, web + Kotlin Android + SwiftUI iOS/iPadOS
Current milestone: evolutionary prototype foundation
Status: existing web core and front-desk sources build; foundation execution in progress; not production-ready

## Confirmed direction

The user confirmed multiple independent restaurant businesses (multi-tenant SaaS), not just outlets of one business. Keep the full scope in `../../PRODUCT.md`. Establish version control, regression verification, tenant/environment isolation and a staging/release path before expanding inventory, business control, loyalty and offline functionality. Current spec: `FOUNDATION.md`; executable plan: `../superpowers/plans/2026-10-18-evolutionary-prototype-foundation.md`.

## Current evidence

- Individual staff/roles, menu administration, immutable server-priced bills, KDS, cash recording and IST sales were browser-observed in the prior increment. Historical evidence is in `FINDINGS.md` and ignored `.local/` files.
- Catalog variants/add-ons and tables/running checks/additional kitchen batches/transfers/amount-based cash splits now have backend + web source and additive V4 migration. Host backend/web builds and packaged Compose builds succeed.
- Real HTTP observations on 2026-10-18: two configured servings produce INR 357; a second coffee batch brings the check to INR 420; split cash INR 200 + INR 220 closes it and increases paid checks by one. Four concurrent batch/final-payment retries produce one batch/payment mutation. Stale versions, occupied table edits, separate batch payment, post-split additions and overpayments are rejected. Snapshot prices remain unchanged after catalog edits. Evidence: `.local/frontdesk-http-observations.json`.
- Current front-desk UI has not yet completed a browser-observed end-to-end journey. No durable automated regression suite exists at the start of this milestone.
- Current runtime is still single-business. Multi-tenant isolation is planned, not claimed implemented: explicit tenant routes, one database per business, separate credentials/sessions/browser journals, and cross-tenant denial verification.
- Existing local database and simulated transaction history are preserved. Development stack: web `http://127.0.0.1:8088`, backend `127.0.0.1:8080`, PostgreSQL `127.0.0.1:54329`. Credentials remain in ignored `.env`; bootstrap never resets an existing owner.

## Foundation work authorized

Initialize an application Git repository, honest current baseline and small feature-scoped commits on a branch. No remote/push or public deployment. Build isolated verification stacks with generated credentials; never run automated mutation checks on development data. Use REA for bounded browser evidence with explicit secret redaction.

## Required work / release gates

- Multi-tenant isolation and separate environment binding; disposable public HTTP/UI regression suite; production-like local staging and recovery drill.
- Tenant onboarding/lifecycle, multi-outlet authorization, public TLS/ingress, production identity/recovery/MFA decisions, monitoring, backup policy, tax/invoice compliance, hardware and accessibility verification.
- Inventory/recipes/receiving/purchasing/wastage, expenses/shifts/reconciliation/reports, customer consent/loyalty, offline durable outbox/device identity/synchronization.
- Native admin/history/KDS/check/choices parity and successful source/device builds. Android SDK is unconfigured; Mac/Xcode/signing access is not established. Phones alone do not satisfy these gates.
- Current splits are exact cash amounts, not per-guest/item allocations. Additions stop at the first payment; full settlement releases the table independently of kitchen progress. Restaurant pilot policies still need validation.

## Next action

Execute the saved foundation plan inline: baseline and branch → isolated public-interface verification → explicit tenant isolation → environment-bound staging and recovery gates. Update this file only with observed results; do not substitute scaffolds or configured CI for successful runtime evidence.
