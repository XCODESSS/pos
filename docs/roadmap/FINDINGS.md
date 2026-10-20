# Findings

## 2026-10-20 — Shared drawer, expenses and counted closing

User accepted one shared drawer per outlet and mandatory open shifts for cash. Continued `bdb73a4` on `feat/cash-control`; scope `CASH-CONTROL.md`. Opening and expense HTTP slices first failed404; missing-shift sale failed200-vs409 before enforcement. A replay with a different shift also failed200-vs409 before fixing exact same-drawer intent. V11 is additive; older migrations untouched.

Public HTTP cases exercise normalized/concurrent opening replay, competing open commands, known counted discrepancies, sale tender120 minus change20 posting100, cash/check splits spanning shifts without duplicate batch recognition, cash/noncash expenses and supplier payments, atomic overflow/date/permission failures, receipt/expense/close races, stale counts, negative expected cash, changed intent, history pagination and independent tenants reusing IDs. Cashier sees only active ID/sequence; owner/manager sees totals and manages drawers/expenses; kitchen denied. Old V5 same-amount cash and exact split-command hashes replay after upgrade with null drawer attribution; no backfill or automatic opening.

Final gate `node verification/run.mjs --host-backend --upgrade-from=counterline-backend:9cb1e27 --browser` passed45 cases (43 core + fresh environment + restore), startup mismatch/role probes and21 REA scenarios. Restore preserves a closed drawer with INR100 opening,25 expense,10 supplier cash,65 expected,64 counted and−1 discrepancy; exact replay does not affect the separate new active drawer. Prior cash/stock/count/purchasing/payables/session evidence remains preserved.

Browser observed INR1,000 opening →250 operating expense →100 supplier cash →650 expected,649 counted,−1 explained shortage. Narrow replay recovered expense after closure without a second outflow; stale closing command rejected after another expense and only closed after reload/recount. Beta ignored alpha's pending and selected drawer state. Inventory and customer sales remained unchanged. Desktop/390px screenshots reviewed. Initial cash browser run only failed its final screenshot anchor because `.purchase-detail h3` matched both shift and movement headings; scoping to the direct child fixed it. No app success was inferred from that failed capture; full subsequent runs passed.

Final ignored artifacts `verification/.artifacts/counterline-verify-fb5e3ffc85f7/`; log `.local/cash-final-gate.log`. New scenario step counts include initial state:
- Shared drawer35: `ev_49ada46289610d4fdccb3234f78e068769e2cb7a6980cf4e400faf49b243491b`.
- Narrow recovery11: `ev_d0ea76c1d0fb828d2af0e32eabfe2a53543a364a755c8f79d3e3612dabb8e0c0`.
- Stale close13: `ev_ca3d6835462542cef87ca20762bf4406c9724cab240a7ab2c766f231ea2f3846`.
- Tenant switch6: `ev_ebfe0fc2a37a1b2493c186268e4659f7f86c298b1721f248ad4a021bc6701d3a`.

Host web build and explicit host-offline JDK distribution/container verification pass. Native Kotlin/Swift sources now select the active drawer and persist original cash commands across uncertain retries. Android `assembleDebug` stopped at missing SDK location before source compilation (`.local/cash-android-build.log`); Mac/Xcode remains unavailable. No native/device/Safari/default-container-download/remote-CI claim. No development/staging restart/promotion, pushes or real-money processing. All runner-owned resources cleaned up. Next: date-range business reports; corrections/refunds/top-ups/fiscal accounting remain explicitly unsupported.

## 2026-10-20 — Supplier bills, partial payments and outstanding balances

Continued `63cd2cd` on `feat/supplier-payables`. Scope/policies in `PAYABLES.md`. HTTP create/payment/void/summary slices each failed404 before implementing the respective route. A final-payment-slot regression failed200-vs400 before preventing the100th partial record from stranding a balance. V10 is additive; V1–V9 unchanged.

Known amounts: INR100 bill →40 recorded payment →60 final leaves zero outstanding and two immutable payments. Concurrent identical requests deduplicate; changed intent, duplicate supplier references, stale versions, overpayments, invalid dates/amounts and mismatched supplier/order links reject without partial mutation. Voids retain unpaid evidence/reference; part-paid/paid voids reject. Due-today balances are not overdue. Summary includes all bills regardless of history pagination. Owner/manager permissions and independent alpha/beta IDs/payment histories are exercised.

Final command `node verification/run.mjs --host-backend --upgrade-from=counterline-backend:9cb1e27 --browser` with installed REA6.5.0/Chrome paths passed38 acceptance cases (36 core + fresh environment + restore), legacy V5→V10 preservation, identity/DB-role probes and17 REA scenarios. Host web production build passed; explicit host Gradle offline distribution packaged/tested in Docker. No default-container/remote CI/native claim. Restore preserved partial supplier payment, optional purchase link, void, balances and exact create/payment/void replay alongside all prior facts.

REA observed INR1,000 supplier invoice linked to an existing quantity order,400 partial payment and600 final after stale-command rejection/reload; a separate unpaid bill was voided. Narrow retained-command recovery did not duplicate the payment and cleared the journal. Beta ignored alpha's selected bill/pending payment. Public before/after stock and customer sales were identical. Reviewed desktop/390px screenshots; not real phones or Safari. Initial browser attempt exposed an unsupported `locator.exact` REA argument, not an application failure; replacing it with a scoped CSS form-button locator passed the subsequent full runs.

Final artifacts `verification/.artifacts/counterline-verify-443cce7f9520/`; log `.local/payables-final-gate.log`. New scenario counts include initial state:
- Payables24: `ev_3fa6938b80eb231174e6f32046fdb14fae98983663527fde3f0e7e29e69106cd`.
- Narrow recovery11: `ev_700b5ed63720e53d5e6461cd7dc7f3d42cdaf1f08c115839b856b14fe1fec232`.
- Stale recovery/final payment15: `ev_ebf2871717bff75c3d26d4d63f098217524b0b18ce7f1af7e59d503190222672`.
- Unpaid void11: `ev_762f4af4c6d4814e9d66a9a4293d3f89ba16930741c09db0aec961896b630edc`.
- Tenant switch6: `ev_ee665ef4ecbbca78a7bdcdfda8735b33bcbcf5a254154ed373a70368cc959d87`.

Docker Desktop was started for the disposable checks, not the user application stacks. Development/staging images, volumes and credentials remained stopped/unchanged; all runner-owned resources cleaned up. No live transfers, promotion or push. Credits/refunds/payment correction/reversal, advances, fiscal accounting and cash-shift posting remain unsupported. Next: expenses and cash-shift reconciliation with explicit outflow attribution, not silently treating these records as processed cash.

## 2026-10-18 — Supplier quantity purchasing and partial deliveries

User asked to continue to the next workflow after physical counts. Started `feat/supplier-purchasing` from count checkpoint `86ab211`. Spec `PURCHASING.md`; backend commit `a690214`. The initial supplier/order/delivery test failed404 before implementation; the close-remainder test failed404 before adding its route/rules. Additive V9 preserves all earlier migration files.

Known-correct quantity behavior: creating a1000g order changes no stock;400g then600g receipts produce exactly1000g and RECEIVED status. Concurrent command retries deduplicate suppliers/orders/deliveries; reordered lines have the same identity. Changed intent rejects. Stale stock, overdelivery, invalid quantities and stock-limit failures leave the entire document/stock unchanged. Competing receipt/close commands have one version winner. Closing a partly received order retains stock and permits exact receipt recovery, but no new receipt. Cashier/kitchen are denied, manager succeeds; alpha/beta reuse supplier/ingredient/order IDs without sharing units, balances or status.

Final full command: `node verification/run.mjs --host-backend --upgrade-from=counterline-backend:9cb1e27 --browser` with installed REA/Chrome paths. All30 acceptance cases (28 core + fresh environment + restore), V5→V9 legacy-bill preservation, startup identity mismatches and cross-database role denial passed. Restore preserves supplier/order, partial receipt, closed remainder, stock link and deduplicated creation/delivery/close replay, alongside all prior money/count/recipe/session facts. TypeScript production build passed. Explicit host-offline JDK build packaged in Docker; no new default-container/remote CI/native verification claim.

REA desktop created Browser dairy supplier, ordered100g, received40g then20g, then explicitly closed40g unreceived. Stock30g→70g→90g. Both immutable delivery documents and staff-linked ledger increases matched public postconditions. Narrow browser recovery replayed the first receipt after closure with no duplicate stock and cleared its pending journal. A separate retained delivery became stale after another1g receipt, was rejected, and required explicit reload; no partial delivery existed. Reviewed desktop/390px screenshots; not physical phones or Safari.

Full ignored artifacts `verification/.artifacts/counterline-verify-42a074bd3669/`; log `.local/purchasing-final-gate.log`. All12 scenarios completed; counts include initial state:
- Front desk46: `ev_3fc61bfb09486d582852ed170432a4dd8845be1a19182aa6342e8a58645ccfdb`.
- Narrow9: `ev_36e6112ea7258e9756a4af68df554bfb7b6c7966e92990cbc711d854a43f3e66`.
- Tenant switch6: `ev_0dfad272137b5f0564fddcdc6a868398f49eb5782c7db9e5a6e08af30f5fcf6a`.
- Inventory setup30: `ev_342ee3d08afa5ed8b025e4042a1456a91fa9e495b44e56e1ce972647ffb86e84`.
- Inventory workflow39: `ev_2b3acf5cf84248f5a8233b2808aac5f3f76c8831a8a1b7d7980fde6783681210`.
- Inventory narrow8: `ev_8016cb5ffab39590d4baa6b9e244abea2051f55a210db8527ccbf4ceade03499`.
- Count19: `ev_c9ec307a6b1f22c28bb68f91743d219e344934d5db6105a3dc8d54c40e5fea8d`.
- Stale count19: `ev_33a27f6e6199f589a1043bb751110fb3ffe02688205994cc1cd62886eeb28399`.
- Narrow count11: `ev_8d60770818a3cbbcb10e6919e86cf62d0ece69a945658499e241692909278be3`.
- Purchasing35: `ev_e0a37a9f55a9026d09080a7a9f2409e0566eeaf3210ce5be462ce0d8ef740554`.
- Narrow purchasing11: `ev_8796ad20147f7755e824c23065ca8d33ab2cbee9973b1e76d11150c45b7bec74`.
- Stale purchasing10: `ev_0f53a12fede8798b02fefa80051779e8f32d03b7d9c97ea88b4fe3d694fb5baa`.

No development/staging restart, data promotion, push or real money processing. Supplier directory currently supports creation/read, not edits/deactivation. Purchase prices, supplier bills/payments, taxes, returns, valuation, expiry/lots and native parity remain required later work. Final plan packaging and custom review schedules remain deferred.

## 2026-10-18 — Physical stock reconciliation

Continued from inventory `2811b31` on local `feat/stock-reconciliation`. First count HTTP test returned404 before implementation; after additive V8/module integration it passed. Expanded public regression cases cover immutable variance, zero-variance observations, concurrent/reordered exact replay, changed intent, stale multi-line atomic rejection, submission/count races, negative-stock numeric bounds, roles and tenants. Existing migrations unchanged; no stock/payments inferred from historical counts.

Final command: `node verification/run.mjs --host-backend --upgrade-from=counterline-backend:9cb1e27 --browser`, installed REA/Chrome environment paths. All24 acceptance cases (22 core + fresh environment + restore) passed, plus V5→V8 preservation, startup identity mismatches and cross-database CONNECT denial. Restore into a new database preserved the count/document/linked movement and unchanged replay, alongside negative-stock/recipe/order/cash/session facts. Host TypeScript production build passed. Host-offline Gradle build was explicitly packaged in Docker; default container dependency downloads and remote CI remain unverified.

REA observed a real reviewed −50g →25g count with one+75g correction. A5g delivery during the next count caused409; a narrow-screen saved-command replay returned original evidence without overwriting the now30g balance and cleared its pending journal. Earlier bill stock evidence remained unchanged. Screenshots of desktop count results and390px recovery were reviewed. No native/device/Safari claim.

Ignored complete evidence: `verification/.artifacts/counterline-verify-eeec190711d1/`; log `.local/counts-full-gate.log`. Nine successful scenarios (step totals include initial state):
- Front desk46: `ev_47f09df9babf315fdecb4d654d035890d60402565725e882ec5141b42c9872c6`.
- Narrow9: `ev_e0b2eb5090893ff0d7af658145e5642158860476e0405bdc342010d4b5ce1cba`.
- Tenant switch6: `ev_985de11cbfdd60b074104b4aed4b528e99323f88923cc6cc9c93a7ea7cfe3dfd`.
- Inventory setup30: `ev_ae4abab65512c28f2ab78339f6a7a5b8b392098790ccfe28b30753f5386ff708`.
- Inventory workflow39: `ev_25a2865bb43bb29bf1d376ac4e6665efaed9fb7e1df00c58b85d2975b60407a8`.
- Inventory narrow8: `ev_cd02b8b2140ec5faf5cfe93df317b752f56c5071862ac9ac620a09998a370883`.
- Count19: `ev_0ac8e8413d377e4478a6dc24cdbeec591ec7911ff93577b4a8c526eeec611656`.
- Stale count19: `ev_2e5ab9814183b5320f61518ff606ec31085885aeeb271742750de7ad801eabc1`.
- Narrow count recovery11: `ev_04978384d51387fe9c01358c6a999361fc4d6528351fce65841ba3f7bda4276f`.

Harness finding: expanded tests exhausted the shared fixture owner's30-sign-ins/15-minute bucket. REA actions without deadlines waited indefinitely for post-login controls, and the outer runner killed the capture without evidence. Explicit per-action deadlines revealed the429 login message. Dedicated disposable browser owners and owner-session reuse within count tests resolve it without changing production authentication. Redacted CLI failure artifacts retain exit/timeout diagnostics. A new browser assertion initially used `order.id` instead of the existing `order.bill.id`; corrected to the documented interface and now asserts200 before comparing immutable stock evidence.

Development/staging stayed stopped; only generated verification containers/volumes were removed. No promotion/push. Supplier purchasing/bills/payment, valuation, schedules and native parity remain open work.

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

## 2026-10-18 — Connected inventory/recipes, warnings and preserved history

User confirmed warning-only shortages (D-009), then requested continuation. The verified foundation was rechecked and fast-forwarded into local main; work proceeded on `feat/inventory-recipes` with a saved spec/plan and small commits. V6/V7 add ingredients, immutable movement/recipe history and saved submission evidence without rewriting V1–V5 or altering user environments.

Critical red/green observations: the ingredient/receiving case first returned404 before routes existed; recipe preview first returned404; accepted-order stock evidence was absent before integration. Those cases passed after implementation. The final gate passes18 public acceptance cases (16 core, one fresh-environment, one restoration), plus wrong-tenant/environment startup, cross-DB role denial and retained-image upgrade probes. Assertions use public responses, not private stock tables.

Known-correct observations: receiving500g then submitting four150g servings succeeds, records a100g shortage and leaves−100g. Concurrent duplicate commands/submissions produce one movement/deduction. Variants replace base recipes and selected extras add per serving; check rounds consume independently, while payment/preparation/replay do not. Negative stock is retained, unknown coverage warns, stale/invalid writes reject, and numeric-range failure leaves no partial order/KOT/stock event.

The actual V5 release image `counterline-backend:9cb1e27` created a paid INR147 legacy bill inside a disposable project. Upgrade to V7 preserved its complete bill/payment; `inventory` remained null and replay after mapping a new recipe did not retro-deduct. The restore drill also preserved negative ingredient balance−50g, two consumption movements, old recipe revision75g, submitted stock snapshot, money totals and sessions.

Docker Gradle downloads failed TLS handshakes on Kotlin dependencies; local JDK21 offline builds succeeded. Explicit `--host-backend` mode rebuilt the current distribution, then packaged/tested it in Docker. No TLS settings were weakened and no test/restore/browser gate was skipped. Default container compilation and remote CI are not claimed passing for this increment.

Final command: `node verification/run.mjs --host-backend --upgrade-from=counterline-backend:9cb1e27 --browser` with installed REA/Chrome paths. Full ignored evidence: `verification/.artifacts/counterline-verify-1025724e578f/`; log `.local/inventory-delivery-gate.log`.
- Foundation desktop46 steps: `ev_7506fb64d66b412cff32f33af1a29ba60c57b359422e5fca8cf0444d92f57d09`.
- Foundation narrow9 steps: `ev_2870daf1d19a0c8c9b4668bb086abb8e539401ee920a9c8ba0c4d2272e3f729b`.
- Tenant switch6 steps: `ev_b258583b6ed8bd44649289397ef1cc0c798fdcdfc18967cfb7e0075f97884edb`.
- Inventory setup30 steps: `ev_23b6fedce6b0d17af88a97fb49f3fc3add676d0111c93370ce7683ded8b63f3f`.
- Inventory workflow39 steps: `ev_b2c95cd43c302998a52b1c9d69dc4bf9736399d72e56261421c431598d6f5146`.
- Inventory narrow8 steps: `ev_a9ca7df78acb45813514a6fc587b1756b62b39bf0d47c3885c8e336d4fee80d9`.

Counts include each scenario's initial state; every declared action completed. Through the actual UI an owner created an ingredient, received100g, recorded5g waste and a5g correction, saved70g then75g recipe revisions and read the historical version. A cashier saw a50g shortage, ordered two servings anyway, and settled INR252. One150g deduction left−50g. Public postconditions verified cashier attribution on order, payment and consumption and no cashier stock-administration navigation. Desktop/390px screenshots were reviewed; this is not Safari/physical-phone verification.

Host web build succeeded and npm audit reported zero known vulnerabilities. Android warning-display sources were changed, but assembleDebug failed before compilation at missing SDK location (`.local/inventory-android-build.log`); Mac/Xcode remains unavailable. No native success is claimed. Both user development/staging stacks remained stopped with their original volumes/credentials/V5 images; inventory was not promoted to them. Manual receiving does not complete purchasing/supplier/payable/valuation/expiry/reversal capabilities.
