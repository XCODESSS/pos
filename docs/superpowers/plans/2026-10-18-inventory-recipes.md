# Inventory and Recipes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect ingredient/recipe stock tracking to accepted food submissions with warning-only shortages and exactly-once deductions.

**Architecture:** Add a tenant-local Inventory module beside Checkout/Catalog. Ingredient balances, append-only movement/recipe history and immutable order-stock snapshots share the existing PostgreSQL transaction; Checkout accepts Inventory as a dependency and consumes only after winning order creation. Keep public HTTP and staff browser seams, additive migrations and the existing price-free kitchen projection.

**Tech Stack:** Kotlin 2.1.21 / JDK21 / Ktor3.2.3, PostgreSQL17.5/Flyway, React/TypeScript, Node22.19 public-interface tests and installed REA6.5.0.

**Spec:** `docs/roadmap/INVENTORY.md`; D-009 in `docs/roadmap/DECISIONS.md`.

## Global Constraints

India/INR, staff-facing multi-tenant SaaS; each business has an isolated database.
Stock shortages warn and allow authorized continuation, with visible negative balances and no manager override.
Preserve receipts, request fingerprints, tenant/environment binding and existing V1–V5 migration checksums.
Keep development/staging stopped. Verification mutations use only runner-owned disposable databases.
No push, remote provisioning, production deployment, fake native verification or guessed historical consumption.
Record quantities as integer thousandths of G/ML/EACH; never use floating-point ledger arithmetic.
No inventory valuation, purchase-order/supplier payable workflow, automatic reversal or reservation is implied.

The named superpowers execution skills are unavailable; execute inline using the available TDD/design/domain-modeling skills. The user requested continuation, so no second execution/delegation prompt is needed. Public HTTP and staff browser test seams continue the agreed foundation convention.

---

## File responsibility map

- Create `backend/src/main/resources/db/migration/V6__ingredient_ledger.sql` and `V7__recipe_consumption.sql`: ingredient identity/balance/manual ledger first, then append-only recipe revisions and order snapshots. Never rewrite a migration after its commit.
- Create `backend/src/main/kotlin/in/counterline/InventoryModels.kt`: validated quantity/target/command DTOs and public snapshots.
- Create `backend/src/main/kotlin/in/counterline/Inventory.kt`: ingredients, manual ledger, recipes, preview and transactional consumption.
- Modify `Identity.kt`, `Tenants.kt`, `Main.kt`: stock permissions, per-business construction and guarded routes.
- Modify `Checkout.kt`, `Models.kt`: inject Inventory, persist consumption once and decode optional snapshots without altering bills.
- Create `verification/inventory.test.mjs`: public ingredient/ledger/recipe/order/check/role/tenant cases.
- Modify `verification/backup-roundtrip.mjs`, `recovery.test.mjs`: stock/revision/snapshot facts survive restore.
- Create `web/src/inventory.ts`: exact decimal quantity parsing/formatting and public types.
- Create `web/src/InventoryView.tsx` and `web/src/RecipeEditor.tsx`: focused manager ingredient/receiving/adjustment/history workspace and recipe editor.
- Create `web/src/StockWarnings.tsx`: reusable live preview and persisted submission-warning presentation.
- Create `web/src/inventory.css`; modify `main.tsx`, `FrontDeskView.tsx`, `api.ts`: navigation, previews and snapshots.
- Create `verification/rea-inventory-setup.json`, `verification/rea-inventory.json`, `verification/upgrade.mjs`; extend `verification/browser.mjs` and runner: real owner setup → cashier/order shortage → ledger/negative-balance observation.
- Modify Android `PosApi.kt`/`MainActivity.kt` and SwiftUI `PosAPI.swift`/`CounterlineApp.swift` to decode/display submission warnings; explicitly mark native builds unverified while toolchains are blocked.
- Modify `GLOSSARY.md`, `docs/API.md`, `docs/roadmap/STATE.md`, `FINDINGS.md`, `PRODUCT.md`, README: domain policy, interfaces, evidence and honest remaining scope.

## Task 1: Ingredient and manual stock ledger

**Interfaces:** `GET /inventory` -> `{ingredients:[Ingredient]}`; `POST /inventory/ingredients` accepts `{id,name,unit,lowStockMilli}`; versioned metadata at `/inventory/ingredients/{id}`; `/inventory/ingredients/{id}/movements` accepts `{id,kind,quantityMilli,reason,reference,expectedVersion}`; `GET /inventory/movements?ingredientId=UUID&limit=50&before=SEQUENCE` returns `{movements,nextCursor}`. Ingredient exposes `{id,name,unit,lowStockMilli,balanceMilli,version,lowStock}`; movements expose signed delta, resulting balance, actor, time, source and optional order ID. Limits: 500 ingredients, ±1,000,000,000,000 milliunits/balance, page1..100.

- [x] Add one public test creating a gram ingredient and receiving 500g; run `node verification/run.mjs` and observe missing route failure.

```js
const create = await api('/inventory/ingredients', {id: uuid(), name: 'Paneer', unit: 'G', lowStockMilli: 100000}, token);
assert.equal(create.status, 200);
const move = await api(`/inventory/ingredients/${create.data.id}/movements`, {
  id: uuid(), kind: 'RECEIPT', quantityMilli: 500000,
  reason: 'Delivery', reference: 'Delivery 1', expectedVersion: 0,
}, token);
assert.equal(move.status, 200);
assert.equal(move.data.ingredient.balanceMilli, 500000);
```

- [x] Implement V6 ingredient/manual-ledger schema, DTO validation, role guards and routes. Under the tenant-local inventory transaction lock, replay exact command intent before checking version, append one movement, update balance/version and audit in the same transaction. Reject changed intent, zero/invalid direction, bad IDs/units/precision, missing reason and stale versions. Do not clamp a WASTE/ADJUSTMENT below zero.
- [x] Rerun the case, then add concurrent receipt replay, changed-command conflict, waste and stale-adjustment cases one at a time; verify public history equals the known signed deltas and balances.
- [x] Add usable ingredient and movement UI with exact three-decimal input, low/negative states, paged history and a tenant-prefixed durable pending-command journal. Uncertain saves retry unchanged; known400/403/404/409 clear pending and require review. No unrecorded direct balance editing.
- [x] Run `npm --prefix web run build`, `cd backend && ./gradlew --no-daemon installDist`, and full `node verification/run.mjs`; commit `feat: add tenant inventory and auditable stock movements`.

## Task 2: Versioned recipes and exactly-once food consumption

**Interfaces:** `GET /inventory/recipes?itemId=...&kind=BASE|VARIANT|ADDON&choiceId=...&version=...` returns target/version/components; `POST /inventory/recipes` accepts `{itemId,kind,choiceId,expectedVersion,components:[{ingredientId,quantityMilli}]}`. `POST /orders/stock-preview` accepts `{lines:[CartLine]}` and returns `StockSnapshot:{requirements,warnings,missingRecipes,recipes}` without reserving/mutating. `Inventory.consume(connection, orderId, lines, menuById, actor): StockSnapshot` is used only inside accepted creation. `Order.inventory` is nullable for historical orders.

- [x] Add a failing public recipe/preview test: receive500g, map150g per serving, preview4 servings and expect required600g/available500g/shortage100g with no movement. Base/variant/add-on mappings are explicit: variant replaces base, add-on quantities add per serving.

```js
assert.equal(preview.data.requirements[0].quantityMilli, 600000);
assert.equal(preview.data.warnings[0].shortageMilli, 100000);
assert.equal((await api('/inventory', undefined, token)).data.ingredients.find(x => x.id === ingredientId).balanceMilli, 500000);
```

- [x] Add append-only recipe revisions and order snapshots in new V7; current version starts0 when unmapped, first save produces1. Canonicalize unique component IDs, validate positive quantities/known ingredients/valid menu targets, preserve old revisions, guard stale writes and exact immediate replay.
- [x] Add a failing order case submitting the four servings; expect HTTP200, -100000 balance, persisted warning and one CONSUMPTION movement. Inject Inventory into Checkout; acquire the inventory lock and consume only after the order insert wins. Persist snapshot/requirements/revisions and movements with bill/KOT; any error rolls back the entire mutation. Order replays return the original inventory snapshot, not a calculation against today's recipe/stock.
- [x] Add concurrent duplicate order and check-batch cases one at a time. Verify one consumption per ingredient/submission, new rounds consume separately, payment/transfer/KDS progress do not consume again, and recipe edits affect future submissions only. Pre-V7 orders remain null, never retro-deducted. Missing mappings produce explicit coverage warnings and preserve ordering compatibility.
- [x] Add role/tenant/precision/bounds cases: cashier previews but cannot manage/read full ledger; kitchen cannot get financial stock administration; foreign ingredient/recipe IDs fail within the selected business; duplicate components and fractional integer quantities reject400. Use public responses only.
- [x] Add manager recipe editor and shared preview/submission warnings to takeaway/check UI. Preview errors are labeled unknown, not successful availability; warnings never disable otherwise valid submission. Recipe version/snapshot labels must distinguish historical facts from current balances.
- [x] Run host builds/full verification and commit `feat: consume recipe stock once per kitchen submission`.

## Task 3: Browser, upgrade/restore and delivery evidence

**Interfaces:** Existing isolated runner/REA browser capture and public inventory/order/check interfaces. No development/staging startup or migration is authorized for this increment.

- [x] Extend the disposable restore fixture to include a mapped ingredient, a submitted negative-balance order and two recipe versions. Before restore capture public facts; after restore assert the same balance, movement count, old recipe revision and immutable order snapshot, in addition to existing money/session checks.
- [x] Add REA scenario: owner creates ingredient, receives100g, maps75g/serving, submits two servings despite a50g shortage, then sees -50g and one consumption entry. Exercise manual waste/adjustment/recipe controls through the actual UI, capturing useful desktop and390px states with declared secret references.
- [x] Run `node verification/run.mjs --browser` with installed `REA_CLI` / `REA_CHROME`, inspect actual complete steps/screenshots and public postconditions. Existing checkout/tenant-switch scenarios must still pass. No real phone/native compilation claim.
- [x] Rehearse V5→V7 in a disposable database by starting the retained verified V5 image before the new image; preserve a public old bill snapshot and confirm no fabricated inventory history. Do not start or alter user development/staging stacks.
- [x] Update API/domain/product/state/evidence docs. Record manual receiving versus unimplemented purchasing/valuation/expiry/reversal scope, still-stopped user environments, exact tests/REA evidence and branch status.
- [x] Run patch/secret checks, host builds and final full verification; commit the verified checkpoints (`e1cdf88` browser/upgrade/recovery gates, `a002473` explicitly unverified native warning sources), followed by the evidence/handoff documentation. Leave the feature branch local and unmerged pending review; no push or automatic user-environment promotion.

## Execution notes

- Foundation was reverified, reviewed inline and fast-forwarded into local main, then `feat/inventory-recipes` was created. No remote/push or user-environment restart.
- Core ledger: `ab5b750`; recipe/consumption integration: `3c65c98`; planning: `3e4fd5f`.
- Container Gradle downloads repeatedly failed TLS handshakes despite successful host compilation. Explicit `--host-backend` mode (`cccb57e`) rebuilds with cached host Gradle in offline mode and packages the fresh distribution. TLS was not weakened; no acceptance/restore/browser gate was skipped. Default container compilation and remote CI remain unverified for this increment.
- Full gate command: `node verification/run.mjs --host-backend --upgrade-from=counterline-backend:9cb1e27 --browser`, with installed REA/Chrome paths in the environment. It exercises 18 public acceptance cases, startup/role probes, real stock/money restore and retained-image V5→V7 preservation, plus six REA scenarios.
- Native warning-display sources were updated; Android assembleDebug was attempted and stopped before source compilation at missing SDK location. Mac/Xcode is unavailable. No native success is claimed.
- Completed final public/REA gate: `verification/.artifacts/counterline-verify-1025724e578f/`, with18 cases and all six scenarios passing. Final browser postconditions include cashier attribution on order/payment/consumption and a50g shortage accepted with−50g balance. Desktop/390px screenshots were reviewed; the narrow management view scrolls directly to the selected ingredient.
- Stock API/domain/state/evidence docs are reconciled. Development/staging remain stopped and unmigrated; the feature branch remains local/unmerged, with no push or automatic image promotion.

## Self-review / exit criteria

Every task includes persisted behavior, permissions, staff UI and public-interface evidence. Shortages are warnings; failed persistence is not. No private DB assertions, historical stock backfill, hidden quantities, duplicate deduction, guessed variant scaling or false purchasing/native/production claims. No unavailable superpowers workflow or delegation is assumed.
