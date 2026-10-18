# Counterline — integrated restaurant product (in development)

Original, staff-facing restaurant software for India. **Development preview, not a production POS and not a verified Petpooja replica.** Counterline is a temporary working name. REA remains in `../rea` as a separate analysis tool; this directory is the application, and has no Git remote configured.

## Evolutionary prototype foundation (2026-10-18)

Multi-tenant SaaS is confirmed. The current development runtime is still single-business; tenant isolation, repeatable verification and staging/recovery gates are the immediate milestone, not completed production capabilities. Front-desk/choices sources now build and have HTTP observations; their browser verification is in progress. Some historical feature lists below describe the previous increment; authoritative current state is `docs/roadmap/STATE.md`.

Execution plan: `docs/superpowers/plans/2026-10-18-evolutionary-prototype-foundation.md`; acceptance spec: `docs/roadmap/FOUNDATION.md`. Git will retain one honest current baseline, then small verified commits on feature branches. No remote or push is authorized. Secrets, local evidence and generated artifacts remain excluded.

## Product scope and current state

The requested target is the **entire connected product**, not independent service demos. `PRODUCT.md` defines the full journey and required delivery gates for staff/catalog, tables/running checks, stock/recipes, reports/shift closing, loyalty, offline continuity and native parity. The complete product is **not finished**; the current verified core connects identity and menu administration to ordering, kitchen work and settlement.

## Implemented core

- Kotlin/Ktor modular backend, PostgreSQL persistence and versioned Flyway migrations.
- Individual owner/manager/cashier/kitchen accounts, server-enforced permissions, password change/reset, disabling/reactivation, version-guarded account editing and persisted opaque sessions. No shared-token authentication fallback.
- Web **Staff accounts** for owners, **Menu management** for owners/managers and **Your account** for password changes. Catalog CRUD covers base dishes, category assignment, paise prices, supported demo tax rates and availability; variants/add-ons remain future work.
- Actor attribution for new orders and cash settlements, plus transactional audit events for identity, menu and order mutations. Historical anonymous attribution remains unknown rather than being rewritten.
- React/TypeScript web counter: search/category menu, takeaway/dine-in, quantities, bill creation, exact-cash settlement, printable demo bill, and today's paid sales in Asia/Kolkata.
- **Orders & bills** workspace: park/resume unpaid bills, browse open/paid/all history with pagination, recover by order UUID, and reopen paid bills for viewing/printing. Unsaved carts and uncertain checkouts cannot be silently replaced.
- **Kitchen display** workspace: one ticket per new order, queued → preparing → ready → served, separate from payment, oldest active tickets first. Bounded pages refresh every 10 seconds while visible; stale/uncertain transitions are guarded by ticket versions.
- Existing pre-kitchen demo bills remain intact with unknown kitchen state; migration never silently queues historical orders.
- Server-owned prices and tax totals in integer paise. Immutable bill snapshots retain item names, prices and rates.
- Client-generated UUID order IDs. Same ID + same canonical cart returns the existing order; different cart returns 409. Cash retries do not double-count revenue.
- Kotlin/Compose Android and SwiftUI iOS client foundations for takeaway checkout against the same backend. **These native clients have not been built/run successfully yet**; see validation below.
- Online retry recovery retains checkout IDs. This is **not** offline mode.

## Start with Docker

Prerequisite: Docker with Compose. From this directory:

```sh
cp .env.example .env
# Edit .env: set a random DB_PASSWORD, OWNER_USERNAME and a unique OWNER_PASSWORD (12–128 characters).
docker compose up --build -d
```

Open **http://127.0.0.1:8088** and sign in with `OWNER_USERNAME` / `OWNER_PASSWORD` from `.env` on the initial installation. Create individual staff accounts in **Staff accounts**. The browser keeps its opaque session token in memory, not local storage; sessions expire after 8 hours. Ports bind to loopback only. Database data survives container restarts in a named volume.

**Bootstrap is first-install only:** owner environment variables are used only while the staff table is empty. Changing `.env` or restarting never resets an existing password or creates a replacement owner. Use **Your account** or the authorized owner reset workflow. After changing your password, the old bootstrap password in `.env` is no longer your login password. It can be removed from the runtime environment once initialized. A lost sole-owner password still needs an approved operational recovery procedure; no public recovery backdoor exists.

```sh
docker compose logs -f backend
docker compose stop
```

Do not run `docker compose down -v` unless you intend to delete the database. This setup does not provide backups. Both application images and the complete Compose stack have now been built/run successfully. Backend readiness checks PostgreSQL; web startup waits for a healthy backend. `/health` is liveness, `/ready` is database readiness. Containers restart unless explicitly stopped, but Docker Desktop itself must be running. This remains local development, not a public production deployment.

## Host development

Prerequisites: JDK 21, Node 22.19+ and npm, Docker for PostgreSQL.

```sh
# From pos/; .env must already contain your local credentials.
# If the packaged stack is running, free the host backend port first:
docker compose stop backend web
docker compose up -d db
set -a; . ./.env; set +a  # Bash/Git Bash; equivalent env setup is needed in PowerShell.
cd backend
./gradlew run             # Windows PowerShell: .\gradlew.bat run
```

In another terminal:

```sh
cd pos/web
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. Vite proxies `/api` to `127.0.0.1:8080`. The backend defaults to loopback and requires `DB_PASSWORD`; first installation also requires valid owner bootstrap credentials. The old `STAFF_TOKEN` is no longer accepted. Its database defaults are `jdbc:postgresql://127.0.0.1:54329/counterline`, user `counterline`; override using `JDBC_URL` and `DB_USER` when needed.

## Native Android

Open `android/` in Android Studio with JDK 21, Android SDK 35, and an emulator. Then:

```sh
cd android
./gradlew assembleDebug
```

The emulator URL is `http://10.0.2.2:8080`. Sign in with an individual staff username/password. Native source now uses the same opaque-session login and sign-out contract. Kitchen-only accounts must currently use the web KDS; native kitchen/admin screens remain unimplemented. Debug-only network configuration permits HTTP only for emulator/loopback hosts. Release configuration disallows cleartext traffic. A physical Android phone can use USB `adb reverse` with `http://127.0.0.1:8080`, without LAN/public exposure. For non-USB devices, use an explicitly configured reachable HTTPS backend. Detailed Android/iPhone instructions and current verification limits: `docs/DEVICES.md`.

## Native iOS/iPadOS

Requires a Mac, Xcode (iOS 17+ SDK), and XcodeGen. From `ios/`:

```sh
xcodegen generate
xcodebuild -project Counterline.xcodeproj -scheme Counterline \
  -sdk iphonesimulator -configuration Debug CODE_SIGNING_ALLOWED=NO build
```

Open the generated project and run on a simulator. Start the backend on that Mac; default URL `http://localhost:8080`. For a backend on another computer, configure a reachable HTTPS development endpoint. Release code requires HTTPS. No iOS build/signing has been attempted on this Windows host.

## Validation performed

- `backend/gradlew --no-daemon installDist` — successful Kotlin server build.
- `web/npm run build` — successful TypeScript and Vite production build.
- `web/npm audit` — 0 reported vulnerabilities at validation time; not a complete security audit.
- Both Docker application images built; `docker compose up -d --wait` started the preserved PostgreSQL volume, healthy backend and packaged web on 8088. Packaged owner login, readiness, permission enforcement for every role and retained sales data were checked. REA also signed into the packaged site, opened menu/staff administration and signed out successfully.
- Real HTTP requests against PostgreSQL: unauthorized access (401), seeded menu, order creation/replay, different-cart conflict (409), invalid quantity (400), insufficient cash (400), rejected client price injection (400), cash settlement/replay, and paid-sales report. Eight concurrent creates and eight concurrent cash retries produced one bill/settlement and one sale in the report.
- REA/Chrome observed the real web flow: two masala dosas + one filter coffee → subtotal INR 340, CGST INR 8.50, SGST INR 8.50 → INR 357 cash recorded.
- New operations: real HTTP observations covered history pagination, legacy preservation, ticket creation/replay, illegal stage jumps, stale-version rejection, served-ticket exclusion and payment/preparation independence. Eight concurrent creates and eight concurrent preparation requests yielded one ticket and one version advance.
- REA/Chrome drove bill recovery → parking → resuming → cash recording → paid history → kitchen preparation → ready. All declared actions completed. Desktop and 390px-wide kitchen screenshots were reviewed. This is not a physical phone or Safari test. Evidence IDs: `docs/roadmap/FINDINGS.md`.
- Integrated product browser observation: owner created cashier/kitchen accounts and a dish through the web UI; cashier ordered that dish; cashier KDS controls were read-only; kitchen-only login prepared it; cashier resumed and settled the same bill. All 43 declared actions completed. Final receipt: subtotal INR 149.50, CGST/SGST INR 3.74 each, total INR 156.98. Staff/catalog/permission actions were real, not mocked endpoints.
- Current HTTP observations verified permission denials (403), legacy token denial (401), old-price receipt preservation after menu edits, unavailable-dish rejection, password/session revocation, reset replay safety, stale reset rejection, disable/reactivate, 64 KiB body cap (413), persisted sessions across restart and login throttling (30 × 401, then 429 for an invalid test username).
- Generated QA accounts were disabled and test dishes marked unavailable after validation. Temporary QA credentials/session files were removed; demo financial records and attribution were retained. Their simulated cash records affect the development report; no real money was processed.
- Android `assembleDebug` — retried after authentication changes and again blocked before compilation by missing Android SDK location. Gradle configuration resolved; this does **not** verify native source compilation.
- Android and SwiftUI authentication sources were updated for individual login, sign-out, session revocation handling and unavailable-cart rows. Neither native client was compiled or run after these changes; macOS/Xcode and the Android SDK remain unavailable/configuration blockers.

There is no automated regression suite yet. Proposed test seams are public identity/catalog/order/checkout/kitchen HTTP and the corresponding staff UI flows. Agree these before adopting the test-first workflow. Manual observations are not a substitute for release gates.

## Explicit limits — do not deploy yet

- Single development outlet, not a multi-tenant SaaS. Owner administration is capped at 100 accounts. No MFA, self-service owner recovery, forced initial password rotation, idle-timeout policy, production audit viewer/tamper resistance or security audit yet. Revocation protects subsequent requests; it does not roll back an already-authorized in-flight transaction.
- Passwords use salted JDK PBKDF2-HMAC-SHA256 (600,000 iterations). OWASP prefers Argon2id for new systems; deployment crypto/provider review is still required, and no FIPS/security certification is claimed. Login rate limits do not yet distinguish original clients behind a trusted reverse proxy. TLS, CSP, monitoring, recovery and abuse testing remain pilot gates.
- Seed menu uses tax-exclusive 2.5% CGST + 2.5% SGST per line. Admin UI additionally supports split demo totals of 0%, 5%, 12%, 18%, 28%, independently HALF_UP rounded to the nearest paisa. This is **not a general GST rule**. No GSTIN, compliant fiscal invoice numbering, inclusive pricing, IGST, cess, refunds/credit notes, or compliance certification.
- Cash is recorded, not processed. The UI confirms exact cash only. No payment gateway, UPI verification, card processing, or drawer reconciliation.
- Kitchen tickets cover one immutable order each; no add-on KOTs, item/station-level preparation, kitchen cancellation/recall, physical KOT printing, audible alerts, table occupancy management, modifiers, discounts, order editing/cancellation, inventory, purchasing, or delivery integrations yet.
- Web history can recover persisted bills even if a tab's current-order journal is cleared. Unsaved carts are not durable; no draft-order storage exists. A parked bill remains OPEN, not a separate server status. Current-bill preparation/payment details are snapshots until refreshed/reopened.
- Native recovery journals retain IDs but not credentials. Native Android/iOS still expose the original takeaway checkout only; order history and KDS screens are web-only in this increment. The shared backend creates tickets for new orders from any client.
- Kitchen uncertainty/retry intent is held while its web workspace remains open, not a durable device outbox. After reload, reconcile against refreshed server state. Polling is not a real-time push channel or outage guarantee.
- No offline sales, cached menu, outbox, sync engine, device identity, or local-network coordination. Network failures must not be treated as payment success.
- No production hardening, load verification, monitoring, backup/restore verification, accessibility audit, or mobile-store readiness.

Full integrated delivery target: `PRODUCT.md`. Current evidence/next work: `docs/roadmap/STATE.md`. Exact interface: `docs/API.md`. Staff/security behavior: `docs/IDENTITY.md`.
