# Suppliers, purchase orders and partial delivery receiving

Continuation after verified physical counts (`86ab211`), branch `feat/supplier-purchasing`. User requested continuing to the next connected workflow. Keep development/staging stopped; no merge, promotion or push. Public HTTP and staff-browser seams remain the agreed verification surfaces.

## Bounded journey

Owner/manager adds supplier → orders ingredient quantities in fixed base units → sees outstanding quantities → receives all or part of the delivery → one immutable delivery receipt and attributable stock increases commit atomically → later deliveries finish the order, or staff explicitly close its unreceived remainder without reversing received stock.

This increment tracks quantity commitments and physical deliveries. It does NOT record supplier prices, tax, payable invoices, payments, valuation, expiry/lots, automated procurement or credit notes. Those follow with explicit accounting policies; no cost is invented from a quantity-only order. Creating an order never receives stock. Receiving must not also be entered through manual stock receipt.

## Rules and interfaces

- Owner/manager only via existing STOCK_READ/STOCK_MANAGE; cashier/kitchen denied, including retries/lookups. All records remain tenant-local.
- `POST /purchasing/suppliers`: `{id,name,contact}` with canonical UUID, printable name1..80/contact0..120, maximum500 suppliers, case-insensitive name uniqueness. Exact creation retries succeed; changed intent409. `GET /purchasing/suppliers` returns `{suppliers}`. Supplier edits/deactivation are outside this first directory scope.
- `POST /purchasing/orders`: `{id,supplierId,reference,lines:[{ingredientId,quantityMilli}]}`. Reference1..80 printable;1..100 unique ingredients, positive integer thousandths up to STOCK_LIMIT per line. Snapshot supplier/ingredient names and fixed units; order line order is normalized for identity. Creation changes no stock. Exact retries recover the current order, changed intent409.
- `GET /purchasing/orders?limit=20&before=SEQUENCE` returns `{orders,nextCursor}` newest first, max100. `GET /purchasing/orders/{id}` returns `{order,receipts}`. Order includes `id,sequence,supplierId,supplierName,reference,actorId,createdAt,version,status,lines` (each ingredient/name/unit/orderedMilli/receivedMilli), plus nullable close reason/actor/time. Status OPEN, RECEIVED (all quantities delivered), CLOSED (explicitly closed remainder).
- `POST /purchasing/orders/{id}/receipts`: `{id,expectedVersion,reference,lines:[{ingredientId,expectedStockVersion,quantityMilli}]}`. Receive1..100 unique ordered ingredients, positive quantities no greater than remaining order quantity. Require observed order and ingredient versions. Any stale/missing/invalid/over-limit line rejects everything. At most100 deliveries/order.
- Receipt response is immutable `{id,sequence,purchaseOrderId,reference,actorId,createdAt,lines:[{ingredientId,ingredientName,unit,quantityMilli,balanceMilli}]}`. Exact receipt UUID/normalized-intent replay returns original evidence even after closure/later movements. Changed intent409. Nonzero PURCHASE_RECEIPT movements link to the receipt. Shared inventory lock coordinates receiving with orders, manual stock and counts. Stock-limit failures roll back order/document/all lines.
- `POST /purchasing/orders/{id}/close`: `{id,expectedVersion,reason}`; reason1..200 printable. Only OPEN orders can close; no financial cancellation or stock reversal. Store command identity/reason/actor/time, reject stale or changed intent. Exact close replay returns the closed order. No reopening/editing/deletion of issued orders in this scope.
- UI preserves exact pending mutation commands in tenant-scoped session storage and retries unchanged. New receipt drafts require explicit reload after409; never silently replace expected versions. Original receipts remain visible in order history and after restore.

## Work checklist

- [x] First public red/green: supplier → order with no stock effect → partial delivery updates remaining quantity and ledger once.
- [x] Replay/concurrent/stale/overdelivery/rollback/close/role/tenant and numeric coverage.
- [x] Connected web Purchasing workspace with supplier/order creation, partial delivery, explicit close remainder, history/recovery.
- [x] Restore preserves purchase order/receipt/link and safe replay; V5 upgrade remains passing.
- [x] REA observed purchase/partial receipt/close and narrow recovery; inspect screenshots; full gate.
- [x] API/product/state evidence and small verified commits. Native purchasing parity remains an open release gate.

## Files

`Purchasing.kt` owns procurement rules/persistence; `PurchasingModels.kt` transport records; V9 adds supplier/order/receipt storage and a movement link without rewriting V1–V8. `Inventory.kt` exposes a narrow internal receipt mutation using existing stock bounds/ledger logic. `Main.kt`/`Tenants.kt` wire guarded tenant routes. `PurchasingView.tsx`/`purchasing.ts`/`purchasing.css` supply a dedicated navigation workspace. `verification/purchasing.test.mjs` and recovery/browser fixtures verify public behavior.
