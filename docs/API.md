# Online checkout interface (v0 development)

Base: `http://127.0.0.1:8080`. Except `/health`, `/ready` and `POST /api/auth/login`, send `Authorization: Bearer <accessToken>` from individual sign-in. Shared `STAFF_TOKEN` values are rejected. API request bodies are capped at 64 KiB; sensitive API responses use `Cache-Control: no-store`. POST bodies use `Content-Type: application/json`. Amounts are integer **paise**, not floating-point rupees. This is a single-outlet development interface, not an integration with Petpooja.

| Method | Route | Result |
| --- | --- | --- |
| GET | `/health` | Liveness and `demo-online` mode; not database readiness |
| GET | `/ready` | PostgreSQL readiness (200 ready, 503 unavailable); no credentials in response |
| POST | `/api/auth/login` | Individual username/password sign-in; opaque access token |
| GET | `/api/auth/me` | Current staff profile and permissions |
| POST | `/api/auth/logout` | Revoke the current session |
| POST | `/api/auth/password` | Change own password and revoke all own sessions |
| GET / POST | `/api/admin/staff` | Owner-only roster / staff creation |
| POST | `/api/admin/staff/{id}` | Owner-only name, role and active-state change |
| POST | `/api/admin/staff/{id}/password` | Version-guarded owner password reset; revokes target sessions |
| GET | `/api/menu` | Available dishes with server prices, tax basis points, availability and version |
| GET / POST | `/api/admin/menu` | Owner/manager full catalog / dish creation |
| POST | `/api/admin/menu/{id}` | Version-guarded dish editing / availability |
| POST | `/api/orders` | Atomically create a demo bill and one queued kitchen ticket; UUID replay recovers them |
| GET | `/api/orders?status=OPEN&limit=25&before=100` | Payment-filtered history, newest bill first |
| GET | `/api/kitchen?limit=50&after=100` | Oldest active tickets first, regardless of payment status |
| POST | `/api/orders/{id}/kitchen` | Version-guarded preparation transition |
| GET | `/api/orders/{id}` | Recover a bill and its current payment state |
| POST | `/api/orders/{id}/cash-payment` | Atomically record physical cash received |
| GET | `/api/reports/today` | Paid bill count and gross paid totals in Asia/Kolkata |

## Individual identity and permissions

Sign in with `{"username":"owner","password":"<your password>"}`. Response: `{ "accessToken":"<opaque random token>", "expiresAt":"<UTC timestamp>", "staff":{ "id":"<uuid>","username":"owner","displayName":"Owner","role":"OWNER","active":true,"version":0 }, "permissions":[...] }`. Login names are normalized to lowercase; passwords are not trimmed. Credentials are not query parameters. `GET /auth/me` returns `{staff, permissions}`, not another token.

Sessions are server-persisted using only a hash of the random token, expire absolutely after 8 hours, survive backend restart and are checked against the current account role/active state on every authenticated request. Logout revokes the presented token; password changes/resets and account updates revoke all target sessions. See `IDENTITY.md` for policy, current limits and operational gaps.

| Capability | Owner | Manager | Cashier | Kitchen |
| --- | --- | --- | --- | --- |
| Available menu / order receipts / checkout / cash / daily gross sales | yes | yes | yes | no |
| Kitchen feed | yes | yes | read-only | yes |
| Kitchen transition | yes | yes | no | yes |
| Full catalog / dish editing | yes | yes | no | no |
| Staff administration | yes | no | no | no |
| Own profile / password / logout | yes | yes | yes | yes |

Owner create: `{ "id":"<new UUID>", "username":"cashier.one", "displayName":"Cashier One", "role":"CASHIER", "password":"<unique 12–128 character password>" }`. Reuse the ID and identical values if the response is uncertain; usernames are unique. Do not store a fast fingerprint of passwords. Staff editing: `{ "displayName":"Cashier One", "role":"CASHIER", "active":false, "expectedVersion":0 }`. Updating revokes existing sessions; the owner cannot disable/demote itself. Conflicting stale versions return 409. No delete operation rewrites historical attribution.

Own password: `{ "currentPassword":"...", "newPassword":"..." }`; success requires signing in again. Owner reset for another account: `{ "newPassword":"...", "expectedVersion":0 }`. Exact immediate reset replays do not revoke a newly issued session again. A stale reset cannot overwrite a later password change. The owner must use own-password change (with the current password) for itself.

## Catalog administration

Create: `{ "id":"<client-selected lowercase UUID or slug>", "item": { "name":"Paneer special", "category":"Mains", "pricePaise":14950, "cgstBps":250, "sgstBps":250, "vegetarian":true, "available":true } }`.

Update `/admin/menu/{id}` with `{ "expectedVersion":0, "item":{...same fields...} }`. IDs are immutable. Supported demo CGST/SGST pairs are equal: 0, 250, 600, 900, 1400 basis points per component. Price is 1..100,000,000 paise. No inclusive pricing, IGST, cess, variants or add-ons exist yet. This is not a tax-compliance claim.

Create retries with the same ID/normalized values recover the existing dish; a different creation intent under that ID returns 409. Exact immediate update replay returns the same version. Other stale writes return 409 and require refresh/review, not automatic version substitution. Unavailable dishes disappear from `/menu` but remain in the admin catalog; historical bill snapshots do not change. Client cart prices are estimates only—new order pricing is owned by the server.

## Create a bill

```json
{
  "id": "b424548f-a5c9-4317-9cd2-85694d903301",
  "lines": [{"itemId":"masala-dosa","quantity":2},{"itemId":"filter-coffee","quantity":1}],
  "orderType":"DINE_IN",
  "tableLabel":"Table 04"
}
```

Use a fresh UUID for a new sale and retain it **before sending**. Retrying the same request must reuse its UUID. Never create a new ID merely because a request timed out. Line order and table whitespace are normalized; duplicate item IDs are rejected. Up to 50 unique items, each quantity 1–99. `DINE_IN` requires a table label (up to 40 characters); `TAKEAWAY` forbids one. No client-supplied prices or totals are accepted.

Response shape:

```json
{
  "bill": {
    "id":"b424548f-a5c9-4317-9cd2-85694d903301",
    "billNumber":"DEMO-000001",
    "createdAt":"2026-10-16T12:00:00Z",
    "orderType":"DINE_IN",
    "tableLabel":"Table 04",
    "lines":[
      {"itemId":"filter-coffee","name":"Filter coffee","quantity":1,"unitPricePaise":6000,"cgstBps":250,"sgstBps":250,"subtotalPaise":6000,"cgstPaise":150,"sgstPaise":150},
      {"itemId":"masala-dosa","name":"Masala dosa","quantity":2,"unitPricePaise":14000,"cgstBps":250,"sgstBps":250,"subtotalPaise":28000,"cgstPaise":700,"sgstPaise":700}
    ],
    "subtotalPaise":34000,"cgstPaise":850,"sgstPaise":850,"totalPaise":35700,
    "currency":"INR","demo":true
  },
  "status":"OPEN","paidAt":null,"cashReceivedPaise":null,
  "kitchen":{"status":"QUEUED","version":0,"updatedAt":"2026-10-16T12:00:00Z"},
  "createdBy":"<authenticated staff UUID>","paidBy":null
}
```

`createdBy` and `paidBy` are server-assigned staff attribution (null for pre-identity historical records); clients cannot supply them. New order/ticket creation, kitchen progression, settlement and their audit events commit atomically. `bill` is an immutable server snapshot. `status` is `OPEN` or `PAID`, derived from persisted payment state. Replays return current payment state, not a new bill. HTTP 200 is used for both creation and replay. Bill numbers may have gaps; these demo numbers are **not GST invoice numbers**.

## Record cash

```json
{"receivedPaise":35700}
```

The amount must cover the bill and be at most 1,000,000,000 paise (INR 1 crore). UI clients currently offer exact cash only. This operation records a staff assertion that physical cash was received; it never debits an account or verifies digital payment. Same-amount retries return the existing settlement; a different amount after settlement returns 409. Row locking protects settlement against concurrent retries. Failed or timed-out responses require recovery/retry, not another physical payment.

## Order history and recovery

`GET /api/orders` accepts `status=ALL|OPEN|PAID` (default ALL), `limit=1..100` (default 25), and optional positive numeric `before` cursor. Results are ordered by descending bill sequence, not by last payment time. Response: `{"orders":[...Order],"nextCursor":"100"}`; `nextCursor` is null when no further page exists. Pass it as `before` for the next older page. Cursors are bill sequence values, not offsets; sequence gaps are normal. Payment status can change between requests; pages are not a frozen reporting snapshot.

Use `GET /api/orders/{id}` to get current payment/kitchen state. Parking is only a web-counter action to set aside a persisted open bill; it does not change its server payment status or suspend kitchen work. No unsaved cart is parked. A paid bill can be reopened for viewing/printing without creating another sale.

## Kitchen tickets and guarded progress

New bill + queued ticket are committed in the same transaction. Retrying order creation does not enqueue another ticket. Historical orders created before this feature have `kitchen: null`; they remain recoverable but are not silently sent to the kitchen or assumed served.

`GET /api/kitchen` accepts `limit=1..100` (default 50) and optional positive numeric `after` cursor. It returns `{orders:[...KitchenOrder],nextCursor}`, oldest bill sequence first, only QUEUED/PREPARING/READY tickets. A KitchenOrder contains only bill identity/time/type/table and item ID/name/quantity, plus payment status and kitchen state. It does **not** expose prices, taxes, totals, cash received or staff attribution. Use `nextCursor` as `after` for later tickets. Served tickets remain in order history, not the active kitchen feed. Counts in the UI describe the loaded page, not all tickets.

Advance with `POST /api/orders/{id}/kitchen`:

```json
{"status":"PREPARING","expectedVersion":0}
```

The only legal chain is **QUEUED → PREPARING → READY → SERVED**. The server locks the ticket row and checks the observed version before updating. A successful transition increments version exactly once and returns the current price-free KitchenOrder. The exact previous transition (same target and expectedVersion) can be replayed while the ticket is still at that immediately resulting state. It returns the same state, not a second advancement. If another stage has since completed, the old request returns 409 and the client must refresh/reconcile; it must not automatically substitute a fresh version and advance again.

Expected errors: `stale_kitchen_ticket` / `invalid_kitchen_transition` (409), invalid version/body (400), `no_kitchen_ticket` (404). After an uncertain network/5xx outcome, retry the **same target and version**, not the next stage. The web workspace retains this intent while open; it is not a durable offline outbox.

Kitchen state and payment state are independent: PAID can still be QUEUED, and SERVED can still be OPEN. Cash recording never marks food served. No kitchen rollback, recall, cancellation, per-item/station routing or add-on tickets exist yet. Only OWNER, MANAGER and KITCHEN may advance tickets; CASHIER may view the price-free feed but cannot advance it. Kitchen-only staff cannot fetch financial order receipts, menu prices or sales reports.

## Errors

Expected errors use `{"code":"...","message":"..."}`. Examples: `unauthorized` / `invalid_credentials` (401), `forbidden` (403), `login_rate_limited` / `authentication_busy` (429), `body_too_large` (413), `invalid_order`/`invalid_id`/`unavailable_item` (400), `not_found` (404), `id_conflict`/`already_paid` (409). A 400 on order creation definitively rejects the request. A transport failure or 5xx does not prove whether the transaction committed: keep the ID and recover it. Unknown JSON fields and fractional integer values are rejected. Generic framework routing/media-type failures may have framework response bodies.

## Tax and later offline work

250 basis points = 2.5%. Compute each line's taxable subtotal using server unit price × quantity, then round CGST and SGST independently HALF_UP to one paisa. Sum the rounded line taxes. This is a demo policy only; obtain tax/accounting validation before using real transactions.

Client IDs, immutable bill snapshots, and idempotent state transitions are useful prerequisites, **not an offline protocol**. Offline work still requires tenant/outlet/device scoping, versioned menus/tax policy, local storage/outbox, conflict rules, reconciliation, and legal invoice numbering decisions.
