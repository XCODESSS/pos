# Evolutionary Prototype Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish local version control, repeatable verification and an isolated staging path for Counterline without claiming production readiness.

**Architecture:** Retain the Kotlin/Ktor modular monolith and PostgreSQL. Multi-tenant SaaS is confirmed: use one database per restaurant business behind a bounded, explicitly configured shared application; sessions and browser journals are tenant-scoped. Verify through public HTTP and staff browser interfaces against disposable Compose projects; promote the same application images into separately configured local staging. Bind database identity to its environment and tenant, preserving all existing Flyway migrations.

**Tech Stack:** JDK 21, Kotlin 2.1.21, Ktor 3.2.3, PostgreSQL 17.5, Node 22.19+, React/TypeScript/Vite, Docker Compose, REA 6.5.0.

**Spec:** `docs/roadmap/FOUNDATION.md`, with full product scope in `PRODUCT.md`.

## Global Constraints

India/INR; staff-facing web, Kotlin/Compose Android and SwiftUI iOS/iPadOS remain required.
Offline remains required after stable online workflows.
Preserve existing development data, immutable bill snapshots and applied migration checksums.
Use explicit permissions, retry identities, integer paise and attributable mutations.
No remote, push, public deployment, external payment processing or real customer data.
Separate fixtures and environment credentials; never run regression mutations against the development database.
Multi-tenant SaaS is confirmed. Initially use database-per-tenant isolation and one outlet per tenant; multi-outlet roles and fleet onboarding remain gates.
Native source compilation and physical-device/hardware validation remain separate gates.

**Harness compatibility:** The named superpowers execution skills are not installed. Execute inline using the available `tdd`, `codebase-design`, `domain-modeling` and roadmap disciplines; do not delegate without user authorization. The user already requested plan execution, so no second execution-choice prompt is needed.

---

## File map and responsibilities

| File | Responsibility |
| --- | --- |
| `.gitignore`, `.gitattributes` | Protect local secrets/artifacts; normalize source line endings |
| `README.md`, `docs/roadmap/STATE.md` | Honest current state and developer commands |
| `verification/compose.yaml` | Disposable real DB/backend/web topology, unique project isolation |
| `verification/run.mjs`, `verification/compose.env`, `verification/health.mjs` | Own stack creation, explicit isolated environment, readiness, test/release process and cleanup |
| `verification/http.mjs` | Small public HTTP client shared by acceptance cases |
| `verification/checkout.test.mjs` | Server pricing, receipt preservation, retry/concurrency and reporting behavior |
| `verification/identity.test.mjs` | Role access and session revocation behavior |
| `verification/frontdesk.test.mjs` | Tables, batches, transfer, split settlement and stale/retry behavior |
| `verification/environment.test.mjs` | Fresh non-demo catalog and public runtime environment |
| `verification/recovery.test.mjs` | Public financial facts survive a backup/restore drill |
| `verification/backup-roundtrip.mjs` | Disposable-stack-only pg_dump/restore orchestration |
| `web/src/FrontDeskView.tsx` | Explicit, browser-observable cash confirmation; preserve pending intent |
| `web/src/frontdesk.css` | Accessible confirmation styling |
| `verification/rea-frontdesk.json` | Declarative, secret-redacted UI journey using known fixture identities |
| `backend/src/main/kotlin/in/counterline/Tenants.kt` | Allowlisted tenant runtimes and per-business data sources |
| `web/src/Tenant.tsx` | Explicit tenant landing path and tenant-scoped storage keys |
| `verification/tenancy.test.mjs`, `verification/init-tenants.sh` | Two distinct databases/roles and cross-tenant denial checks |
| `backend/src/main/kotlin/in/counterline/Environment.kt` | Parse supported environments and bind new/existing databases safely |
| `backend/src/main/resources/db/migration/V5__environment_identity.sql` | Durable environment marker, additive migration only |
| `backend/src/main/kotlin/in/counterline/Main.kt` | Enforce environment policy before accepting traffic |
| `compose.staging.yaml`, `.env.staging.example`, `ops/configure-staging.mjs`, `ops/init-staging.sh` | Separate loopback staging, generated non-overwriting secrets and a restricted tenant DB role |
| `.github/workflows/verify.yml` | Build and run the isolated verification command on CI |
| `docs/OPERATIONS.md` | Release, migration, restore, rollback and outstanding production gates |
| `docs/API.md`, `PRODUCT.md`, `docs/roadmap/*` | Reconcile documented interfaces and actual validation evidence |

## Task 1: Honest local baseline and branch

**Files:** Modify `.gitignore`, `README.md`, `docs/roadmap/STATE.md`; create the foundation spec and this plan.

**Interfaces:** Existing Git CLI and repository source; produces local `main` baseline and `feat/prototype-foundation` branch.

- [x] Expand ignores for `.env.*` except examples, signing keys, IDE state and verification outputs. Retain Gradle wrapper JARs and lockfiles.
- [x] Correct the saved state: catalog choices/front desk build and HTTP observations exist; browser verification and durable automated tests are not yet complete. Preserve historical evidence rather than asserting old documentation is current.
- [x] Run `git init -b main`, then `git add .` from `pos/`. Inspect `git diff --cached --stat`, `git ls-files`, `git check-ignore .env .local/frontdesk-http-observations.json web/node_modules` and staged secret-pattern findings without printing credentials.
- [x] Commit `chore: establish Counterline prototype baseline`; run `git switch -c feat/prototype-foundation`. This is a snapshot of current work, not fabricated historical commits.

## Task 2: Isolated public checkout regression path

**Files:** Create `verification/compose.yaml`, `verification/run.mjs`, `verification/http.mjs`, `verification/checkout.test.mjs`.

**Interfaces:** `api(path, body?, token?) -> Promise<{status, data}>`; tests read `VERIFY_BASE_URL`, `VERIFY_OWNER_USERNAME`, `VERIFY_OWNER_PASSWORD`. Runner owns a randomly named Compose project and generates credentials in memory.

- [x] Add one real HTTP case creating a dish priced at 14,000 paise and an order of quantity two. Use the worked expectation below; run the test without the fixture stack and observe a missing-endpoint failure.

```js
const { data: order } = await api('/orders', {
  id: randomUUID(), lines: [{ itemId: dish.id, quantity: 2 }],
}, owner.accessToken);
assert.equal(order.bill.subtotalPaise, 28000);
assert.equal(order.bill.cgstPaise, 700);
assert.equal(order.bill.sgstPaise, 700);
assert.equal(order.bill.totalPaise, 29400);
```

- [x] Implement a runner using `spawn('docker', ['compose', '--project-name', project, '--file', composePath, ...])`; never load `pos/.env`. Build explicit `counterline-verify-backend` / `counterline-verify-web` images, start services with `up -d --wait`, discover the ephemeral web port using `port web 80`, then spawn `node --test --test-concurrency=1 verification/checkout.test.mjs`.
- [x] Restrict public HTTP tests to the runner's loopback `VERIFY_BASE_URL` and require a verification-run marker. Cleanup calls `down --volumes --remove-orphans` only with the exact generated project and verification file. On failed startup/tests, print bounded service logs but no environment/config dumps. Handle cancellation and preserve failure exit codes.
- [x] Run `node verification/run.mjs`; expect the literal 29,400-paise bill check to pass and all generated stack resources to be removed.
- [x] Add checkout replay, concurrent duplicate create/payment, changed-cart conflict, invalid quantity, stale price and immutable snapshot cases one at a time. For each: run the focused case, add only required fixture/support code, rerun.
- [x] Run `npm --prefix web run build` and `backend/gradlew --no-daemon installDist` (Windows Git Bash paths from `pos/`). Commit `test: add isolated checkout acceptance verification`.

## Task 3: Identity and front-desk behavior plus browser evidence

**Files:** Create `verification/identity.test.mjs`, `verification/frontdesk.test.mjs`, `verification/rea-frontdesk.json`; modify `web/src/FrontDeskView.tsx`, `web/src/frontdesk.css`, `verification/run.mjs`.

**Interfaces:** Existing `/api/auth/*`, `/api/admin/*`, `/api/tables`, `/api/checks/*`, `/api/kitchen`, `/api/reports/today`; existing React `request<T>()` and pending-command journal.

- [x] Add a role test that creates a kitchen account, signs in, expects `GET /api/tables` and `POST /api/admin/menu` to return 403, and checks the KDS projection omits prices.
- [x] Add a session test that disables an account and expects its previously issued token to return 401; cover cashier refusal for table administration.
- [x] Add one front-desk case: two servings at variant 15,000 + add-on 2,000 paise produce a 35,700-paise batch; a coffee batch produces 6,300; combined check total is 42,000. Transfer the check, record 20,000 then 22,000, and expect one additional paid check and 42,000 additional sales, never two sales. Assert batches cannot be paid separately, retries do not duplicate KOTs/cash, and post-payment additions fail.
- [x] Extend the runner to run the three public-interface files serially. Run `node verification/run.mjs` after each vertical case.
- [x] Replace the native `window.confirm()` for check cash with an explicit in-page confirmation displaying the fixed amount. Store `{path, body}` as the confirmation intent before sending, preserve its version/UUID on confirm, cancel without mutation, and retain the exact journaled command for uncertain responses.

```tsx
{cashConfirmation && <section aria-label="Confirm received cash">
  <p>Confirm physical cash received: {money(cashConfirmation.amountPaise)}</p>
  <button onClick={() => void confirmCash()}>Confirm cash received</button>
  <button onClick={() => setCashConfirmation(null)}>Cancel cash confirmation</button>
</section>}
```

- [x] Create a REA scenario using environment-backed `VERIFY_OWNER_PASSWORD`, public labels and CSS locators. Drive login, menu choices, two batches, kitchen preparation, table transfer, partial cash confirmation and final settlement. Capture accessibility and page errors; capture screenshots at the useful terminal state. No raw token/password artifacts.
- [x] Invoke the installed REA 6.5.0 entry point with `capture-browser-scenario verification/rea-frontdesk.json --format json`; run only against the runner-owned disposable web stack. Report exact completed steps and any omitted coverage. Review a desktop and narrow-screen capture.
- [x] Commit the related verification in smaller checkpoints (`999d38e` role/check HTTP cases and `936b151` REA/UI work), rather than the originally suggested `test: verify staff and running-check workflows` with related UI fixes, not a claim of native or production readiness.

## Task 3A: Explicit multi-tenant SaaS isolation

**Files:** Create `backend/src/main/kotlin/in/counterline/Tenants.kt`, `web/src/Tenant.tsx`, `verification/tenancy.test.mjs`, `verification/init-tenants.sh`; modify `Main.kt`, `web/src/api.ts`, `main.tsx`, `Session.tsx`, `FrontDeskView.tsx`, `web/nginx.conf` and verification runner/Compose.

**Interfaces:** Immutable `TenantConfig(id, slug, jdbcUrl, username, password, ownerUsername, ownerPassword)` creates one `TenantRuntime` containing the existing identity/catalog/checkout/front-desk modules. Registry lookup is by explicit `/t/{tenant}/api` path, never caller-supplied JDBC or a global API fallback. Native clients use a configured base URL ending `/t/{slug}`.

- [x] Add a public case against tenant alpha and beta with identical staff usernames and dish IDs: alpha session on beta must return 401; beta's own session cannot retrieve alpha's order/check IDs (404), and its report/menu remains independent. Observe failure before tenant routes exist.
- [x] Implement a bounded startup registry (at most 32 configured tenants, per-tenant pool size 3), reject duplicate IDs/slugs, close every opened pool on startup failure/shutdown, and return no configured tenant inventory publicly. Unsupported tenant paths cannot create pools or provision databases.
- [x] Mount existing staff handlers under `/t/{tenant}/api`; authentication resolves the selected tenant before checking its session. Reject `/api` as an ambiguous route. Keep every module bound to its tenant's data source, including reports, staff administration and health readiness.
- [x] Add a landing form at `/` accepting a tenant slug; tenant pages live at `/t/{slug}/`. Build all HTTP paths from that immutable page context. Prefix every recovery/pending/draft storage key with the tenant slug; bearer tokens remain memory-only. Do not copy unscoped old browser journals into an arbitrary tenant.
- [x] Create two databases with distinct nonsuperuser owners in the disposable PostgreSQL server. Revoke PUBLIC database CONNECT and grant each owner only its own database. Feed the runtime registry through environment-backed JSON, not committed credentials.
- [x] Run the full acceptance suite including tenancy cases. Verify native configured URLs can include the tenant path; document native UI parity/build limits rather than claiming successful device tests.
- [x] Commit tenant routing together with its mandatory database identity binding (`de8ae41`), rather than a route-only isolation claim.

## Task 4: Environment-bound staging without demo fixtures

**Files:** Create `backend/src/main/kotlin/in/counterline/Environment.kt`, `backend/src/main/resources/db/migration/V5__environment_identity.sql`, `verification/environment.test.mjs`, `compose.staging.yaml`, `.env.staging.example`; modify `Main.kt`, verification Compose and runner.

**Interfaces:** `AppEnvironment.from(value: String?): AppEnvironment`; `prepareEnvironment(source: DataSource, environment: AppEnvironment, tenantId: String): Unit`; `APP_ENV` supports `development`, `verification`, `staging` only. Production intentionally fails closed until release gates are satisfied.

- [x] Add a fresh-verification public test expecting `GET /api/menu` to return `[]` before test fixtures and `/health` to identify `verification`. Run it first and observe the seeded-menu/development-mode failure.
- [x] Add V5 with `environment_identity(singleton BOOLEAN PRIMARY KEY CHECK(singleton), name TEXT NOT NULL, tenant_id UUID NOT NULL)`. Never change V1–V4 or their checksums.
- [x] After Flyway and before owner bootstrap/listening, acquire a transaction advisory lock and bind the database to its environment. Reject a mismatched existing environment or immutable tenant marker, including accidental database reuse by another tenant. For an unbound non-development database require empty staff, orders, tables, checks, payments and audit data; remove only the untouched eight known V1 seed rows, require the remaining catalog to be empty, then bind it atomically. Existing development data is preserved.
- [x] Pass `APP_ENV=verification` in the isolated Compose file. Rerun `node verification/run.mjs`, with the environment case first.
- [x] Add runner lifecycle probes: restarting backend with the same environment succeeds and persisted sessions work; starting it with `APP_ENV=staging` on its verification volume exits nonzero and does not expose a ready listener; restore the expected environment and verify unchanged public order data.
- [x] Add standalone staging Compose requiring explicit `BACKEND_IMAGE`, `WEB_IMAGE` and credentials from `.env.staging.example`; use a separate named volume, no DB/backend host ports, and loopback web port 18088. Do not start a public service.
- [x] Commit staging/verification infrastructure in verified checkpoints (`de8ae41` tenant/environment binding and `9cb1e27` staging/recovery/release tooling).

## Task 5: Repeatable release and recovery gates

**Files:** Create `.github/workflows/verify.yml`, `verification/backup-roundtrip.mjs`, `verification/recovery.test.mjs`, `docs/OPERATIONS.md`; modify README, API/product/state/roadmap/decisions and runner.

**Interfaces:** Existing runner-owned Compose identity; PostgreSQL 17 `pg_dump`, `pg_restore`; public `GET /api/orders/{id}`, `GET /api/checks/{id}`, `GET /api/reports/today` for restored facts.

- [x] Add a recovery check that reads a known paid order/check over HTTP after a runner-triggered roundtrip and compares unchanged literal totals, receipt lines and payment count.
- [x] Implement the drill only inside the disposable project: stream `pg_dump --format=custom` to an ignored temporary file; stop the verification backend; restore into a newly created scratch database on the same verification PostgreSQL server; start backend against that database with the same `verification` binding; verify public facts; clean up the runner-owned volume/file. Never execute database replacement against development/staging.
- [x] Run the full suite and restore drill with `node verification/run.mjs`. Confirm the development Compose services/volume remain healthy and present afterward.
- [x] Add CI on push/pull request: checkout, Node 22.19.0, `npm ci` and web build, JDK 21 and backend distribution build, `node verification/run.mjs`. No deployment or external secrets; generated credentials exist only for the job.
- [x] Document exact local release image tagging, separate staging env/volume, readiness checks, migration backup, app rollback limitations after schema changes, restore validation and manual production gates. Note CI has only been configured until an actual remote CI run exists.
- [x] Update evidence-backed state and mark only executed plan checkboxes complete. Preserve remaining inventory/offline/native work and open tenancy/tax/security decisions.
- [x] Commit the CI/recovery gate (`9cb1e27`) and final verified tooling/documentation checkpoints; inspect `git status`, `git log --oneline --decorate`, `git remote -v` and secret exclusions. Do not push or merge a failing branch.

## Execution notes

- Existing checkout/identity/front-desk behavior was characterized through the public interface; those cases were already green. New tenant routing and fresh non-demo environment cases were observed failing before implementation, then passing. The restore gate failed before the drill existed, and the first actual drill exposed a restart/readiness issue before the corrected reload path passed. Do not misreport all characterization cases as red-first feature work.
- Task 3A and the binding portion of Task 4 were committed together because routing alone would not prevent a misconfigured second tenant from reusing a database. UI/REA checks followed that isolation change so all browser mutations ran in disposable tenant databases.
- The restore script is an isolated child process rather than a general production restore command. Production backup retention, privilege separation and incident recovery remain gates.
- Final acceptance completed: clean commit `9cb1e27` passed the HTTP/restore/REA gates; the same tested images were promoted locally and started in separate staging with zero catalog/sales, matching image IDs and credentials/session preservation on restart. Development upgrade preserved all 14 orders, 11 catalog records, two tables and current-day gross sales. Evidence: `docs/roadmap/FINDINGS.md` and `STATE.md`.
- A final harness check explicitly excluded automatic `.env` loading via `verification/compose.env`; nine acceptance cases plus identity/role probes and the restore drill passed afterward. CI remains configuration only because no remote or push exists. Production gates are deliberately not checked off by these local results.

## Exit review

The milestone is complete only if the isolated command and restore drill pass, the browser journey has actual observed evidence, the existing development DB is preserved, the branch contains small coherent commits, and current docs distinguish local staging groundwork from production readiness. Missing native toolchains, hosted HTTPS/monitoring and multi-outlet/accounting policy and hosted SaaS lifecycle remain explicit blockers rather than invented implementations.
