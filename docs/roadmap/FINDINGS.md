# Findings

## 2026-10-16 — What REA provides

Evidence: `../rea/README.md`, `../rea/DISCLAIMER.md`, and the REA workflow skill. REA inspects selected artifacts/runtime observations and returns evidence. It is not a hosted POS backend or application framework. Cloning it does not recover Petpooja's server implementation.

Source: https://github.com/morluto/rea (local checkout); `origin` points to https://github.com/XCODESSS/rea.git and `upstream` to the original. No REA source was modified.

Implication: keep tooling and the new application separate; use REA only where actual observations support a design question.

## 2026-10-16 — Public Petpooja feature inventory (partial)

Question: which restaurant workflows are publicly documented?

Method: REA 6.5.0 `capture-browser-scenario` launched a temporary Chrome profile, navigated to https://www.petpooja.com/poss, waited for the main heading, and retained accessibility text. No login, demo form submission, private app access, or private network inspection occurred. The owned browser was terminated by the provider.

Evidence ID: `ev_25f236162e042faa615001b115ee7bd4067326787a78ef58180134f97cbe02d6`.
Local complete Evidence: `.local/rea-public-evidence.json` (ignored, retained locally).

Observed public text describes billing, KOT, split bills/table merging, discounts, inventory deduction, reporting, online order management, CRM and integrations. This establishes **public marketing claims only**, not observed authenticated product behavior, exhaustive feature coverage, or implementation details.

Implication: recreate useful workflows with original code; exact parity remains unknown.

## 2026-10-16 — Online implementation evidence

Real PostgreSQL-backed HTTP observations:
- Unauthenticated menu request: 401.
- Eight server-priced demo menu items returned.
- Two masala dosas and one filter coffee: subtotal 34,000 paise, CGST 850, SGST 850, total 35,700.
- Same-order replay returned the same demo bill; changed table under the same ID returned 409.
- Insufficient cash and negative quantity returned 400.
- Exact cash settlement and replay returned PAID without a second paid bill in the report.
- Eight simultaneous identical order requests returned one bill number. Eight simultaneous cash requests returned one settlement timestamp; the sales report increased by one bill and 8,400 paise, not eight bills.
- An attempted client-supplied `totalPaise` field returned 400; the server did not accept client pricing.

REA 6.5.0 then drove the actual local web counter with a secret-reference staff token, added the same quantities, created a bill and recorded exact cash. Every declared action completed. The final accessibility capture included total INR 357 and 'Cash payment recorded'; screenshot was visually inspected. The provider terminated its temporary browser.

Evidence ID: `ev_54d34c2e45855e41ef3c59a56526de7580eb6059ed4e37d8c80e52616e983db4`.
Local complete Evidence: `.local/rea-checkout-evidence.json`; screenshot `.local/checkout.png` (ignored).

Build evidence: backend `installDist` and web `npm run build` succeeded. Web `npm audit` reported 0 vulnerabilities after pinning Vite 6.4.4. This is not a security certification or automated regression suite.

Native limitations: Android `assembleDebug` stopped before compilation because no Android SDK location is configured. No Swift compiler/Xcode is available on this Windows host. Native source correctness and real device behavior are unverified. Full Docker web/backend images have not been built.

## 2026-10-16 — Order history and kitchen operations increment

Source-derived behavior: Flyway V2 adds a kitchen ticket table and indexes without updating historical orders. Each newly created order inserts its ticket in the same transaction as its immutable bill. Version-checked, row-locked preparation transitions are independent of row-locked cash settlement. Historical kitchen state remains null rather than being inferred.

Real PostgreSQL HTTP observations:
- Old bills remained readable with null kitchen state; the initial active kitchen feed was empty after migration.
- Order replay returned the existing queued ticket. Direct QUEUED → READY was rejected with 409.
- PREPARING version 0 retry returned the same version 1; a stale request after READY returned 409.
- SERVED tickets left the active feed but remained recoverable in order history; a served, unpaid bill could still be settled.
- Eight concurrent identical creates yielded one queued ticket; eight concurrent identical preparation commands yielded the same version 1 and timestamp, not multiple stage advances.
- Payment left the new ticket QUEUED, demonstrating separation of food and payment state.
- A history traversal with two-row pages returned eight unique bills across four pages with no duplicates at that observation time. Invalid filter, excessive page limit, malformed/repeated cursor and negative expected version were rejected.

REA 6.5.0/Chrome drove the web flow: recover DEMO-000011 → park it → resume the same bill → record cash → locate it under Paid bills → start preparation → mark ready. Every declared action completed; the final capture showed the PAID ticket still READY, with the separate Mark served action available.

Desktop Evidence ID: `ev_17739b29186392e9ab319f67ce59016808c03069719aab37d58942159cdcbd38`.
Local complete Evidence: `.local/rea-operations-evidence.json`; reviewed screenshot `.local/kitchen-desktop.png`.

Responsive-width Evidence ID: `ev_123c38054718057266ee3c4ac55f8d2b55b533199ac9fb755b828900d1250d4a`.
Local complete Evidence: `.local/rea-responsive-kitchen-evidence.json`; reviewed screenshot `.local/kitchen-responsive.png` at 390×1200. This is desktop Chrome at a narrow viewport, not a real Android/iOS or Safari test. REA's temporary browser cleanup was verified from its result.

Current Kotlin server and web production builds succeeded; web npm audit still reported 0 known vulnerabilities. These are build checks and bounded manual observations, not an automated regression suite, load test, security audit or evidence of physical printer/phone support.

User reports having Android and iOS phones. Host Android SDK/adb remains unconfigured; Mac/Xcode access and iOS signing are unknown. `docs/DEVICES.md` records a local Android USB reverse-port route and distinguishes it from iOS HTTPS/signing requirements. No device connection, installation or public network exposure was performed.

Implication: online operations can now be demonstrated, but native parity, real device checks, staff identity/outlet scoping and production gates remain outstanding.

## 2026-10-17 — Integrated identity/catalog/order product core

User direction: implement all proposed capabilities sequentially as the entire end-to-end product, not a collection of disconnected services. `../../PRODUCT.md` records the required journey and completion gates; the full product is not finished.

Implementation evidence: Flyway V3 added staff, hashed sessions, persisted login buckets, audit events, catalog versions and nullable order/payment attribution. It did not rewrite old receipt snapshots or assign historical anonymous actions to the new owner. The old shared staff token was rejected with 401. Identity sources and limits are documented in `../IDENTITY.md` with primary OWASP/Ktor references checked on this date.

Real PostgreSQL HTTP observations:
- Owner created manager/cashier/kitchen accounts; each signed in with its own password. Cashier could not administer staff/menu; kitchen could not fetch financial receipts or menu prices; manager could not administer staff (403).
- Owner created a dish priced at 12,345 paise. Cashier ordered two units: total 25,924 paise. Manager changed its future unit price to 23,456; the original receipt still held unit 12,345 / total 25,924. A later single-unit order used total 24,628. A stale edit returned 409; making the dish unavailable blocked new checkout with 400.
- Kitchen feed/transition JSON omitted monetary fields. Food progress was independent of settlement. New receipt/settlement attribution matched the authenticated cashier.
- Owner reset another password and revoked its old sessions; the old password failed. An immediate reset replay preserved a new login session. Self-password change revoked sessions; a stale previous reset returned 409 rather than overwriting the new password. Logout tokens could not be reused.
- Disabling an account rejected its session and login; reactivation preserved its password. Owner self-demotion returned 409 and uppercase-path self-reset returned 400.
- Oversized login body returned 413. An invalid test username received 30 credential failures followed by 429 under the persisted 15-minute limit; the owner was not locked out. Source rate keys are based on the actual peer, not trusted forwarded headers.

REA 6.5.0 performed 43 declared actions through the real web UI: owner sign-in → create cashier and kitchen staff → create Service Special at INR 149.50 → cashier sign-in and order → cashier sees read-only KDS → kitchen-only sign-in/preparing/ready → cashier returns to the same receipt → records INR 156.98 exact cash. Final bill: 14,950 subtotal + 374 CGST + 374 SGST = 15,698 paise. All actions completed. The final cashier navigation omitted staff/menu administration.

Evidence ID: `ev_5988e49d58e62dfb00c1ae1e8a5db110eedbbd5d682766d2dbfb3d4173b58f14`.
App-root local complete Evidence: `.local/rea-product-flow-evidence.json`; reviewed screenshot `.local/integrated-product.png`. The temporary browser was terminated by the provider. Structured secret references were used; generated test passwords were checked absent from retained evidence. This is a bounded browser observation, not a durable regression suite or physical-phone test.

## 2026-10-17 — Packaged application / preservation / remaining gates

Both Docker application images built successfully. Replaced the verified host Java process with the Compose backend, recreating the database container against the existing named volume rather than deleting data. `docker compose up -d --wait` completed with healthy DB/backend and running web. Public host bindings remain loopback only. Backend `/ready` checks PostgreSQL and gates web startup; `/health` is only liveness.

At http://127.0.0.1:8088, anonymous protected requests returned 401, persisted owner credentials/identity still worked, session expiry parsed as a portable millisecond UTC timestamp and sensitive responses had no-store. All role policies were rechecked through the packaged reverse proxy. Manager/kitchen write requests for a nonexistent ticket reached the business 404, while cashier was denied at 403. Sales data remained three simulated paid bills / 66,250 paise for the observed IST date; the database and prior owner were not reset.

REA signed into the packaged frontend, loaded actual catalog/staff administration and signed out. All declared actions completed. Evidence ID: `ev_4b7a44fc2499ee70ddd4c208780deb66214e9b1787a9988de7aedbbf3a3c197b`.
App-root complete Evidence: `.local/rea-packaged-product-evidence.json`; reviewed screenshot `.local/staff-management.png`. Browser cleanup reported terminated-owned-process. Build log: `.local/compose-build.log`.

Generated QA accounts were disabled after checks; test dishes were marked unavailable. Temporary QA credential/session files were deleted, and verification sessions were explicitly revoked. Simulated bills, staff IDs and transactional audit history were retained, so QA cash records remain visible in development reports. No external payment was processed.

Host Kotlin and TypeScript/Vite builds succeeded; web npm audit reported zero known vulnerabilities at that time. Android assembleDebug was retried after source authentication changes and again stopped at missing SDK location, before native compilation. SwiftUI/Xcode remains unavailable on this Windows host. Native sign-in source changes are not native build/device verification.

Implication at that date: there was a runnable connected identity/catalog/checkout/kitchen/cash core, including packaged deployment proof. Later entries supersede parts of that day's remaining-work list; none imply production readiness.

## 2026-10-18 — Evolutionary SaaS foundation verification

The user confirmed multi-tenant SaaS and authorized a durable plan, execution, local Git and incremental commits. The application now has a baseline on main and a foundation branch; no remote or push. Spec: `FOUNDATION.md`; plan: `../superpowers/plans/2026-10-18-evolutionary-prototype-foundation.md`.

A shared backend explicitly routes business paths to independent PostgreSQL databases/roles. Disposable acceptance stacks verify identical business usernames/menu IDs/order UUIDs remain independent, cross-business sessions fail (401), foreign order/check IDs fail (404), wrong tenant/environment markers reject startup, and a tenant's DB role cannot CONNECT to another tenant database. Fresh non-development catalogs start without demo fixtures. This proves the selected local isolation paths, not a penetration test or hosted SaaS control plane.

`node verification/run.mjs` passes nine acceptance cases, two startup-misconfiguration probes, a DB-role denial and a real restore roundtrip. Dumping and restoring into a fresh scratch DB preserves a paid 15,698-paise bill, a check with 7,000 + 8,698-paise payments, session facts and gross sales. The first restore attempt exposed a web-container restart/ephemeral-port readiness issue; the drill now reloads Nginx and waits for readiness without reallocating its host port. Only generated verification projects/volumes are removed.

REA 6.5.0 observed the real configured-menu → two kitchen batches → kitchen ready → transfer → cancelled confirmation → 20,000 + 22,000-paise cash → closed 42,000-paise check workflow. Narrow-screen recovery and a second business with an alpha recovery key seeded also completed. Reviewed screenshots show total/cash INR 420 and zero balance, two immutable batches and separate preparation states.

Complete local evidence under ignored `verification/.artifacts/counterline-verify-831c6cc63293/`:
- Desktop: 46 completed steps, `ev_15bf5c2c50e081ad7d0106a9d09638aa66b6f951e972dfa128f5ca95be965988`.
- 390px recovery: 9 completed steps, `ev_81b2f977a2d3ea2d0c3b942e2df510b8968a96113fc563047ef199c28dfe8a59`.
- Tenant-switch: 6 completed steps, `ev_dcbc6c9a01d6efc55b859b5945782baec27a4bc50970af58465f54695ea7d8e1`.

Counts include REA's initial scenario state; all declared actions completed. Declared owner secrets were environment-backed; no request/response body capture or bearer-token storage was selected. This is desktop Chrome, not Safari/physical phones or printer testing. Host builds succeeded; npm audit reported zero known vulnerabilities at validation time. CI configuration is not a remote CI execution.

## 2026-10-18 — Exact-image staging promotion and preserved development upgrade

Clean commit `9cb1e27` passed all nine HTTP/recovery acceptance cases, two database-identity mismatch probes, the cross-database role denial and the complete REA gate. Complete release-run evidence is under ignored `verification/.artifacts/counterline-verify-5a4845fbdf0f/`:
- Desktop: `ev_899325e1989a6e86af66d1e1d1d5c113a2ba77dd15e5ae74896f8cebd19f7bf1`.
- Narrow recovery: `ev_fc96181d64cca4e42fc2431a248702fb3721aa87a3fb2d193b00b16de56cda5b`.
- Tenant-switch: `ev_b847125b37c6b1b71e59a5dea4195b3e6d04ad7aedc0c1d4b2e5afe231f5fe05`.

The runner tagged the same tested application image objects without rebuilding/pushing. Separate local staging then started with those tags and new generated credentials/tenant identity/volume, empty catalog and zero sales. Owner/session persisted after backend restart; comparison against `release.json` confirmed identical running image IDs:
- Backend: `sha256:104a846545607a5bb0d529c1669d5c60e6b2b6b70c59aa8dcc6dd71373a69d28`.
- Web: `sha256:a933939fbc5e15744d007c83d3c031d5c98ba461d6d64b3fbe1efa6aa69d9e08`.

Public development facts captured before the upgrade were identical after migration into the stable demo tenant context: 14 orders, 11 menu records, two tables, 42,000 paise current-day sales, including complete bill/payment/kitchen payloads. The original owner credentials still worked. No development volume was deleted and no live payment/provider was touched. Local bounded records: `.local/staging-smoke.json`, `.local/pre-foundation-promotion.json`, `.local/development-preservation.json`.

A final verification-tooling fix explicitly passes an empty Compose env file so development `.env` cannot be auto-loaded. The complete non-browser acceptance/restore/misconfiguration suite passed again afterward. This is verified local pre-production groundwork, not hosted production readiness, automated fleet onboarding, native compilation or a remote CI run.
