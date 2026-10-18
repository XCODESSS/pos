# Online tenant interface (development / staging preview)

Business API base: **`http://127.0.0.1:8080/t/demo/api`** for development; substitute an explicitly configured business code for another tenant. All table routes below are relative to that business API base. There is **no unscoped `/api` fallback**. Neither a client-supplied tenant field nor a header changes the selected database.

Except `POST /auth/login`, send `Authorization: Bearer <accessToken>`. Each business has independent staff/session storage; a token from another business returns 401. Unknown businesses return 404 without creating a pool/database. Bodies use JSON, capped at 64 KiB; unknown properties/fractional integer fields are rejected. Responses use no-store. Money is integer **paise**, not floating-point rupees.

At the server root only: `GET /health` returns liveness/mode/environment; `GET /ready` checks all configured tenant DBs (200/503), without listing them or credentials. They are not business APIs or complete operational monitoring.

| Method | Business-relative route | Result |
| --- | --- | --- |
| POST | `/auth/login` | Individual sign-in |
| GET | `/auth/me` | Profile + permissions |
| POST | `/auth/logout`, `/auth/password` | Revoke session / change own password |
| GET / POST | `/admin/staff` | Owner staff roster / creation |
| POST | `/admin/staff/{id}`, `/admin/staff/{id}/password` | Account editing / versioned password reset |
| GET | `/menu` | Available dishes, choices, prices and versions |
| GET / POST | `/admin/menu` | Owner/manager full catalog / creation |
| POST | `/admin/menu/{id}` | Versioned menu update |
| GET | `/inventory` | Owner/manager ingredients, balances and low-stock state |
| POST | `/inventory/ingredients`, `/inventory/ingredients/{id}` | Ingredient setup / versioned metadata |
| POST | `/inventory/ingredients/{id}/movements` | Retry-safe receiving, waste or signed adjustment |
| GET | `/inventory/movements` | Ingredient-scoped immutable movement history |
| GET / POST | `/inventory/recipes` | Current/historical recipe revision / guarded new revision |
| POST | `/orders/stock-preview` | Cashier/manager stock warnings, no reservation or deduction |
| GET | `/tables` | All floor/table records with current open check ID |
| POST | `/admin/tables`, `/admin/tables/{id}` | Owner/manager table create / versioned update |
| POST | `/checks` | Open a table visit |
| GET | `/checks/{id}` | Aggregate batches, payments, totals and current table |
| POST | `/checks/{id}/batches` | Submit a new kitchen round |
| POST | `/checks/{id}/transfer` | Move the whole check to an available table |
| POST | `/checks/{id}/cash-payments` | Record an exact full/partial cash amount |
| POST | `/checks/{id}/close-empty` | Release a check with no batches/payments |
| POST | `/orders` | Standalone demo bill + kitchen ticket |
| GET | `/orders`, `/orders/{id}` | History / recovery, including linked batches |
| POST | `/orders/{id}/cash-payment` | Standalone bill cash recording only |
| GET | `/kitchen` | Price-free active tickets |
| POST | `/orders/{id}/kitchen` | Versioned preparation progress |
| GET | `/reports/today` | Fully settled order/check count and gross sales, Asia/Kolkata |

## Identity and permissions

Login body: `{"username":"owner","password":"<operator-supplied password>"}`. Response: `{accessToken,expiresAt,staff:{id,username,displayName,role,active,version},permissions:[...]}`. The token is opaque, independently random, persisted only as a hash and valid for eight hours unless revoked. Login names normalize to lowercase; passwords do not trim. Tokens remain client-memory-only. Password/account changes revoke sessions; they cannot roll back already-authorized in-flight work.

| Capability | Owner | Manager | Cashier | Kitchen |
| --- | --- | --- | --- | --- |
| Menu/receipts/checks/cash/reports | yes | yes | yes | no |
| Table administration | yes | yes | no | no |
| Inventory/recipes/full stock history | yes | yes | no | no |
| Order stock preview/submission snapshot | yes | yes | yes | no |
| Kitchen feed | yes | yes | read-only | yes |
| Kitchen progress | yes | yes | no | yes |
| Menu administration | yes | yes | no | no |
| Staff administration | yes | no | no | no |
| Own profile/password/logout | yes | yes | yes | yes |

Staff create: `{id,username,displayName,role,password}` with a new UUID and 12–128 character password. Editing: `{displayName,role,active,expectedVersion}`. Reset another account: `{newPassword,expectedVersion}`. Own password: `{currentPassword,newPassword}`. Owner cannot disable/demote itself. Exact immediate updates/resets may replay; conflicting stale values return 409. Usernames are unique **within the business**, not globally. See `IDENTITY.md` for rate limits and production gaps.

## Catalog and configured dishes

Create `/admin/menu`:

```json
{"id":"paneer-special","item":{"name":"Paneer special","category":"Mains","pricePaise":10000,"cgstBps":250,"sgstBps":250,"vegetarian":true,"available":true,"variants":[{"id":"large","name":"Large","pricePaise":15000,"available":true}],"addons":[{"id":"cheese","name":"Cheese","pricePaise":2000,"available":true}]}}
```

Update `/admin/menu/{id}`: `{expectedVersion,item}`. Dish/choice IDs use 3–64 lowercase letters/digits/hyphens, starting with a letter/digit. Up to 20 variants and 20 add-ons, unique within their list. Variant prices are absolute serving prices (replace the base); add-ons are charged once per serving and inherit the dish's demo tax rate. When variants exist, one available variant is required. Add-ons are optional, each selected at most once. Dish/variant prices: 1..100,000,000 paise; add-ons may be zero.

Supported equal CGST/SGST rates per component: 0, 250, 600, 900, 1400 basis points. This is demo tax configuration, not compliance advice. Existing bill descriptions/prices/taxes never change when catalog values change. Create IDs recover the same normalized intent; conflicting IDs/stale updates return 409. Availability replaces deletion of historical identities.

## Standalone order/bill

```json
{"id":"b424548f-a5c9-4317-9cd2-85694d903301","lines":[{"itemId":"paneer-special","quantity":2,"variantId":"large","addonIds":["cheese"]}],"orderType":"TAKEAWAY","tableLabel":null}
```

Retain the UUID before sending, and reuse it for uncertain retries. Up to 50 distinct **dish configurations**, quantity 1–99 each; same item with different choices is allowed. Duplicate configurations must combine quantities. Choice order and line order are canonicalized. Missing/null variant and absent/empty add-ons are equivalent for a base dish. No client prices/totals/actor IDs are accepted.

Standalone DINE_IN + tableLabel is retained for old clients (printable label, ≤40 characters), but does not reserve a table; new dine-in work must use checks. Direct `/orders` requests cannot attach a `checkId`.

An `Order` contains immutable `bill:{id,billNumber,createdAt,orderType,tableLabel,lines,subtotalPaise,cgstPaise,sgstPaise,totalPaise,currency,demo}`, payment `status,paidAt,cashReceivedPaise`, `kitchen:{status,version,updatedAt}`, actor IDs, optional `checkId` and `currentTableLabel`. Bill lines contain item ID, snapshotted description including selected choices, quantity, unitPricePaise, tax rates and line totals. Prices are not looked up when reopening a receipt. Bill numbers may have gaps and are **not legal GST invoice numbers**.

Standalone cash body: `{receivedPaise}` covering the total and ≤1,000,000,000 paise. Exact same-amount replay returns the existing settlement; a different paid amount returns 409. Linked batches reject this route with `check_settlement_required`—settle their parent check instead. Cash is recorded, never processed or digitally verified.

## Tables and running checks

Table create: `{id,table:{label,floor,seats,active}}`; update `{expectedVersion,table}`. Labels ≤40 characters, floors ≤60, seats 1–100. Location names are case-insensitively unique within each business. Occupied tables cannot be edited/deactivated. Up to 200 tables in the current preview.

Open: `{id,tableId}`. Only active, free tables can open. Reusing the exact opening ID/table returns the current check, even after transfer/closure; it does not reopen a visit.

Submit: `{id,expectedVersion,lines:[...CartLine]}`. The command ID also identifies its immutable batch bill and ticket. Each new round queues only those dishes; prior rounds are not resent. Maximum 100 batches/check and 1,000,000,000 total paise. A first recorded payment locks further additions.

Transfer: `{id,expectedVersion,tableId}` to an active, free table. Previous batch bill table labels remain snapshots; KDS projects the **current** table so food follows the party.

Cash: `{id,expectedVersion,amountPaise}`, positive and no more than the outstanding balance. Exact received amounts only; no change, gateway confirmation, per-guest allocation or per-item split. Maximum 200 payments. Full coverage closes the check and releases its table immediately, regardless of kitchen progress. Empty release: `{id,expectedVersion}` at `/close-empty`, allowed only with zero batches/payments.

Check commands persist exact intent/fingerprint. Replays return the latest aggregate without repeating the mutation, even if later commands have advanced/closed it; a reused command ID with different intent returns 409. New commands must use the observed version. Refresh/review after 409; never silently substitute a new version into an uncertain command.

`RunningCheck` includes `{id,number,table,version,createdAt,closedAt,status,batches,payments,totalPaise,paidPaise,duePaise}`. Status: OPEN before payments, SETTLING after partial payment, CLOSED after settlement/empty release. Payments contain ID, amount, time and receiving staff ID. Batch paid flags are updated together only at full settlement; the immutable bill snapshots do not change.

## Inventory and recipes

Ingredients: `POST /inventory/ingredients` with `{id,name,unit,lowStockMilli}`; units `G`, `ML`, `EACH` are immutable. IDs are canonical UUIDs; names are case-insensitively unique per tenant and at most80 printable characters. Quantities are integer **thousandths of the displayed base unit** (`quantityMilli=75000` means75g when unitG), not paise. UI accepts three decimals; no implicit kg/litre conversion. Maximum500 ingredients; thresholds0..1,000,000,000,000 milliunits. An `Ingredient` has `{id,name,unit,lowStockMilli,balanceMilli,version,lowStock}`; it starts at zero. Update only `{expectedVersion,name,lowStockMilli}`; stock/metadata changes increment its version.

Manual movement body: `{id,kind,quantityMilli,reason,reference,expectedVersion}`. Kinds RECEIPT/WASTE require positive quantities; ADJUSTMENT accepts a signed nonzero delta. WASTE subtracts the positive amount. Opening stock is an explained ADJUSTMENT, never an unrecorded direct balance setter. Reason1..200 printable characters; reference is optional, ≤80. Amounts/balances remain within ±1,000,000,000,000 milliunits; negative stock is allowed, numeric overflow is not. Same command ID + normalized intent recovers its immutable movement/current ingredient; changed intent/stale versions return409. Response `{ingredient,movement}`.

History: `GET /inventory/movements?ingredientId=UUID&limit=25&before=SEQUENCE`. Defaultlimit50, maximum100; positive sequence cursor, newest first. Response `{movements,nextCursor}`. Each movement records ingredient/name/unit snapshots, signed delta/resulting balance, kind, command ID or linked order ID, reason/reference, actor ID and time. Neither receiving nor waste/adjustment rewrites an earlier event. Receiving here is not a supplier payable or purchase-order workflow.

Recipes: POST `{itemId,kind,choiceId,expectedVersion,components:[{ingredientId,quantityMilli}]}`. Kinds BASE (null choice), VARIANT and ADDON (valid choice belonging to the dish). Up to40 unique ingredients; positive quantity ≤1,000,000,000 milliunits per serving. Variant recipes **replace** BASE; selected add-on recipes add requirements for each serving. There is no inferred size multiplier. Read `/inventory/recipes?itemId=...&kind=BASE` or add choiceId/version. Unmapped current recipe returnsversion0/empty components; first save produces1; later revisions append. Exact immediate save replay is safe; conflicting stale writes return409. A historical version remains readable. Empty components clear future coverage without erasing prior revisions.

Preview body `{lines:[CartLine]}` uses normal menu/quantity validation and returns `{requirements,warnings,missingRecipes,recipes}`. Requirements aggregate per ingredient; warnings expose requiredMilli/availableMilli/shortageMilli with name/unit. Recipes identify target, revision and serving count. Preview reserves nothing; amounts can change before acceptance. Owner/manager have full stock access; cashiers can preview/see submission evidence but cannot administer ingredients/recipes or inspect the full ledger.

New standalone orders and check batches atomically commit recipe consumption, stock warning snapshot, bill and KOT. `Order.inventory` returns that immutable StockSnapshot; migrated older bills remain `inventory:null`, never retro-deducted. Recipe changes, later receipts, payment, table transfer, preparation and order retries do not recalculate or repeat deductions. Missing mappings warn and remain orderable during rollout; unknown ingredient use is not guessed. Kitchen-only projections still omit stock and financial details.

**Warn, not block:** ordinary shortages succeed without manager approval, record full consumption and expose negative balances. Shortages do not bypass menu availability, permissions or persistence/numeric validation. A failed transaction rolls back order/KOT/stock together. Customer bill printing excludes internal stock warnings.

## History, kitchen and reports

Orders: `status=ALL|OPEN|PAID`, `limit=1..100` (default25), positive bill-sequence `before` cursor. Response `{orders,nextCursor}` newest first. `Order.checkId` tells clients to open the parent check, not offer standalone payment. Closed check recovery is by ID or a linked batch from order history; parking is only client navigation, not another server payment state.

Kitchen: `limit=1..100` (default50), positive bill-sequence `after` cursor, oldest active first. Response `{orders:[KitchenOrder],nextCursor}`. It exposes bill identity/time/type/current table, item descriptions/quantities and payment/preparation state, never prices/taxes/cash/staff attribution. Legacy orders without tickets remain unchanged, not silently queued.

Kitchen progress body: `{status:"PREPARING",expectedVersion:0}`. Only QUEUED → PREPARING → READY → SERVED. Exact immediate transition retry is safe; stale/later-stage retries require reconciliation. SERVED means food completion, not payment. No station routing, recall or cancellation yet.

`reports/today` returns `{date,timezone,paidOrders,totalPaise}`. A fully settled multi-batch check counts **once**, not once per batch. Partial check cash remains visible on the check and is not recognized as paid sales until final settlement. This is not a cash-shift reconciliation report. Each line's CGST and SGST round independently HALF_UP to one paisa before summing.

## Failure semantics

Expected problems use `{code,message}`: 400 invalid/unavailable choices/body; 401 invalid/expired/revoked session; 403 role denial; 404 unknown tenant/entity; 409 stale/conflicting command; 413 body cap; 429 bounded auth/rate controls. Routing errors may use framework bodies. A transport failure or 5xx does **not** prove a mutation failed—keep its ID and recover/retry the same intent. Client retry journals are not offline sales or a multi-device sync protocol.
