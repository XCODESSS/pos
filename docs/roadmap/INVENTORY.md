# Inventory and recipes — connected increment

User direction: continue the full restaurant product, with stock shortages warning rather than blocking (D-009). Work on `feat/inventory-recipes` after the verified foundation was fast-forwarded to main. Keep development and staging stopped; use only disposable verification stacks. No push or production deployment.

## Operating journey

Owner/manager creates ingredient → records opening/received stock → maps dish/variant/add-on recipes → cashier previews stock and submits dishes → the accepted kitchen submission consumes stock exactly once → shortages warn but the order succeeds → owner/manager sees negative/low balances and the immutable movement history → receiving/waste/adjustments reconcile stock.

## Domain and invariants

- Ingredients belong to the current tenant database. Base units are G, ML or EACH, immutable after creation. `quantityMilli` represents thousandths of that base unit, using integers throughout. UI accepts up to three decimals and displays explicit units; no implicit kg/litre conversion.
- Each ingredient starts at zero. Opening stock is an attributable ADJUSTMENT with a reason, not a hidden balance setter. RECEIPT and WASTE use positive quantities; ADJUSTMENT uses a signed nonzero delta. All manual movements require reason and a client command UUID, plus observed ingredient version.
- Every balance change has an immutable movement; negative balances are allowed and visible. Metadata/low-stock changes are version-guarded and never change units or erase history.
- A base dish has a BASE recipe; selecting a variant uses its VARIANT recipe instead of BASE; selected ADDON recipes contribute additional requirements per serving. No inferred size multiplier or ingredient substitution.
- Recipe revisions are append-only. Each revision contains unique ingredient IDs and positive quantities per serving. Empty components explicitly clear coverage. Missing/cleared mappings warn and are not invented as zero-consumption recipes; orders remain available during rollout.
- New takeaway orders and check batches consume recipe requirements in the same database transaction as the bill/KOT. Prices/old receipts remain immutable. Payment, kitchen progress, transfers and retries never consume again. Pre-inventory orders remain `inventory:null`; migration never backfills their consumption.
- Snapshot recipe versions, requirements, shortages and missing coverage at submission. Later receiving/recipe edits never rewrite that evidence. Current previews reserve nothing and can become stale; they never masquerade as a guaranteed stock reservation.
- Shortage warnings name required/available quantities; continuation needs no manager override. Persistence/permission/catalog validation failures still reject the transaction. Quantity bounds prevent unsafe arithmetic, not negative-stock business blocking.
- Owner/manager manage/read full stock/recipe/movement records. Cashiers can preview submission warnings and see submission snapshots, not administer stock. Kitchen projection stays price-free and does not gain stock administration.

## Current acceptance scope

Ingredient setup/metadata/low stock; receiving, waste and adjustment movements; recipe versions for base/variant/add-on choices; warning-only preview and submission; traceable consumption in standalone orders and additional check batches; concurrent replay/stale/role/tenant checks; restore verification; actual web administration/ordering observation through REA.

Purchasing here is manual stock receiving with a reason/reference, not supplier accounts, purchase orders, payable invoices, inventory valuation, expiry/lot management, reservations, refunds/cancellations or automated reversals. Those remain required product work with separately defined policies. Native inventory UI parity/builds remain open gates; native basic orders still use the authoritative shared backend.

## Test seams

Continue the already agreed public HTTP and staff-browser seams. Assertions inspect ingredient balances, movement history, recipe versions and order/check snapshots returned by public routes, never private DB rows. Existing CI/backup/tenant gates remain required. Add one behavior case and implementation at a time.
