# Counterline — evolutionary restaurant POS prototype

Original, staff-facing restaurant software for India/INR: web, Kotlin/Compose Android and SwiftUI iOS/iPadOS. **Development/pre-production foundation, not a production POS or verified Petpooja replica.** Multi-tenant SaaS is confirmed; one business is one tenant, not one outlet. REA remains a separate analysis/verification tool in `../rea`.

Full delivery contract: `PRODUCT.md`. Current evidence: `docs/roadmap/STATE.md`. Foundation plan: `docs/superpowers/plans/2026-10-18-evolutionary-prototype-foundation.md`.

## Implemented and verified scope

- Individual staff accounts, owner/manager/cashier/kitchen permissions, password/session lifecycle and attributable mutations.
- Menu/category administration, absolute-price variants and per-serving add-ons with availability/version guards.
- Server-priced immutable demo bills, takeaway checkout, open/paid history, bill recovery, cash recording and IST gross paid sales.
- Floor/table setup, occupancy, running checks, multiple immutable kitchen batches, transfers and exact amount-based split cash payments. First payment locks dish additions; full settlement releases the table independently of kitchen progress. Guest/item splits, refunds and voids are not implemented.
- Ingredient stock/low-stock setup, receiving/waste/explained adjustments, immutable movement history and versioned base/variant/add-on recipes. Accepted food submissions consume stock once; previews and persisted shortage/coverage warnings allow ordering and expose negative balances. Owner/manager administration is connected to cashier ordering.
- Physical stock counting with reviewed variances, atomic ledger corrections, immutable history, stale-version protection and retry/known-ID recovery.
- Supplier directory, quantity purchase orders, partial deliveries into stock and explicit closing of unreceived remainders. Immutable delivery evidence, stale-version guards and exact retry recovery; quantity orders do not imply prices or payable amounts.
- Supplier bills with independently entered INR totals, optional order links, partial/final payment recording, outstanding/overdue balances and unpaid-bill voiding. Reviewed owner/manager UI, immutable payment evidence and safe retry recovery; no money processing or duplicate stock receiving.
- Price-free KDS with queued → preparing → ready → served and guarded retries.
- Explicit `/t/{business-code}/api` routing to separately configured tenant databases. Staff sessions and browser recovery journals are tenant-scoped; no global `/api` fallback. Two-business isolation and tenant/environment database-binding checks run in the acceptance suite.
- Disposable real PostgreSQL HTTP verification plus a backup-to-fresh-database restore drill. REA observes desktop, 390px receipt recovery and tenant-switch workflows.
- Separate loopback-only staging configuration and local promotion of the exact verified images. CI configuration exists; it has not run remotely and does not deploy.

This is not the completed product. Supplier credits/payment reversals, procurement pricing/returns, stock valuation/expiry/reversals, business control, loyalty, offline operation, SaaS lifecycle administration, multiple outlets per business and full native parity remain required. Manual stock receiving is not the whole purchasing module. Operational/security/tax/hardware release gates are explicit in `docs/OPERATIONS.md`.

## Local development with Docker

Prerequisite: Docker with Compose. From this directory:

```sh
cp .env.example .env
# Set a random DB_PASSWORD and unique OWNER_PASSWORD (12–128 characters).
docker compose up --build -d --wait
```

Open **http://127.0.0.1:8088/t/demo/**, or open `/` and enter business code `demo`. Initial owner credentials are from ignored `.env`. Bootstrap runs only on an empty staff table; restart/environment edits never reset existing staff passwords. Use the account/reset workflow after setup. The shared `STAFF_TOKEN` is rejected.

The existing prototype database is preserved as the development `demo` business with a stable tenant UUID. Do not change that identity or reuse this volume/credentials in staging. `.env`, local evidence, signing material and generated outputs are excluded from Git.

```sh
docker compose logs -f backend
docker compose stop
```

Ports bind loopback: web 8088, backend 8080, PostgreSQL 54329. Database data survives restarts. Never run `docker compose down -v` unless deliberately deleting that environment is separately approved.

## Verification and staging

Prerequisites for verification: Node 22.19+ and Docker/Compose. No running development server is required; no development credentials are loaded.

```sh
node verification/run.mjs
```

The runner builds app images, creates two isolated synthetic businesses with separate database roles/credentials and random loopback ports, checks the public interfaces, rejects mismatched identities and restores a dump into a fresh scratch database. It removes only its own generated resources.

Optional REA browser checks use already installed executables:

```sh
export REA_CLI=/absolute/path/to/rea-agents/scripts/rea.mjs
export REA_CHROME=/absolute/path/to/chrome
node verification/run.mjs --browser
```

See **`docs/OPERATIONS.md`** for exact verified-image promotion, separate synthetic staging on port 18088, migration/rollback/recovery procedures and production gates. Never promote the prototype database or secrets. Staging is local HTTP, not public production hosting.

## Host development

Prerequisites: JDK 21, Node 22.19+, Docker for PostgreSQL.

```sh
# From pos/; free port 8080 before starting a host backend.
docker compose stop backend web
docker compose up -d db
set -a; . ./.env; set +a
cd backend
./gradlew run
```

In another terminal:

```sh
cd pos/web
npm ci
npm run dev
```

Open **http://127.0.0.1:5173/t/demo/**. Vite proxies tenant API paths to the host backend. The default development registry uses `DB_PASSWORD`, `DB_USER` (default counterline), `JDBC_URL` (default `jdbc:postgresql://127.0.0.1:54329/counterline`) and the stable demo tenant identity. Non-development configurations must supply `TENANTS_JSON`. Never log that secret registry.

Build checks: `npm --prefix web run build` and, from `backend/`, `./gradlew --no-daemon installDist`. The CI workflow runs those plus isolated HTTP/recovery verification, without external secrets or deployment.

## Native clients

Android source: open `android/` with Android SDK 35 and JDK 21; run `./gradlew assembleDebug`. Emulator URL is **http://10.0.2.2:8080/t/demo**. USB device URL after `adb reverse tcp:8080 tcp:8080` is **http://127.0.0.1:8080/t/demo**. Never weaken release cleartext restrictions.

SwiftUI source: requires Mac/Xcode, iOS 17+ SDK, XcodeGen and signing for physical installation. From `ios/`, run `xcodegen generate`, then build the Counterline scheme in Xcode. Simulator backend URL is **http://localhost:8080/t/demo** on the backend's Mac; physical devices require an approved reachable HTTPS endpoint.

Both native clients retain their complete server base URL with checkout IDs and reject recovery against a different base. Old unscoped prototype journals are not silently assigned to a business; recover known IDs through the authorized demo web workspace. Sources currently expose basic takeaway checkout, not variants/check/admin/KDS/inventory-management parity. They now decode/display submission stock warnings, but this native source change remains uncompiled/device-unverified. Android SDK location and Mac/Xcode/signing remain blockers: **neither native client is claimed compiled/device-verified**. Device instructions: `docs/DEVICES.md`.

## Git workflow

The application has its own local Git repository. `main` retains the honest initial source snapshot; the verified foundation was fast-forwarded to `main`; inventory is retained on `feat/inventory-recipes`; its physical-count continuation is on `feat/stock-reconciliation`; quantity purchasing is on `feat/supplier-purchasing`; current supplier bills/payment work continues on `feat/supplier-payables`. Make small feature-scoped commits after relevant verification, not fabricated retrospective commits or one final giant commit. No remote or push is configured/authorized. Merge only after the branch's release gates pass and the intended release scope is reviewed.

## Important limits

All prices/taxes are demo calculations; no compliant fiscal invoice numbering, inclusive GST/IGST/cess, tax certification, payment gateway or UPI confirmation. Cash is a staff assertion, not money processing. No offline outbox/synchronization, hardware certification, public deployment, production recovery/MFA, observability service, independent security audit, backup retention policy or app-store readiness is implied. API details: `docs/API.md`; identity policy: `docs/IDENTITY.md`.
