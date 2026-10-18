# Restaurant operations

The language of staff ordering, billing and kitchen work in Counterline. Payment and food preparation are separate activities.

## Language

**Staff account**: An individual employee's named access to restaurant work, governed by a role and active status. Disabling it does not erase the employee's historical actions.

**Owner**: The restaurant operator who controls staff access and all supported business operations.

**Manager**: A staff member who manages the menu and restaurant operations without administering other staff accounts.

**Cashier**: A staff member who takes orders and records received cash, and can read kitchen progress without changing it.

**Kitchen staff**: Staff who prepare and hand over dishes without access to receipt prices, cash amounts or sales reports.

**Menu item**: A priced dish or drink offered for ordering. Later price or availability changes do not alter already issued bill snapshots.
_Avoid_: Product (ambiguous with the software product)

**Variant**: A mutually exclusive version of a dish, such as small or large, with its own serving price.

**Add-on**: An optional extra attached to each serving of a chosen dish or variant.

**Dining table**: A named seating location in a restaurant floor or area. An occupied table has an open running check.

**Running check**: The customer's accumulating dine-in account, containing all submitted kitchen batches and recorded payments for one table visit.
_Avoid_: Open bill (a fixed bill rather than an accumulating account)

**Kitchen batch**: One round of dishes submitted together under a running check. Later rounds are additional batches, not replacements for earlier instructions.

**Split settlement**: Recording several cash amounts against one running check until its balance is fully covered. A split amount does not assign particular dishes or guests.

**Order**: A customer's requested dishes and quantities for takeaway or a dine-in table.

**Bill**: The fixed item prices, tax breakdown and total owed for an order. Demo bills are not compliant GST tax invoices.
_Avoid_: Invoice (for the present demo document)

**Open bill**: A bill whose cash payment has not been recorded. Its food may already be preparing, ready or served.
_Avoid_: Pending order (ambiguous between payment and preparation)

**Parked bill**: An open bill set aside at the counter so another order can be taken. Parking does not stop food preparation or record a payment.

**Kitchen ticket (KOT)**: The kitchen's preparation instructions for a takeaway order or one submitted kitchen batch. Recording payment does not complete a kitchen ticket.
_Avoid_: Receipt (payment document), bill (amount owed)

**Kitchen display (KDS)**: The staff workspace showing active kitchen tickets and their preparation progress.

**Queued**: The kitchen ticket is waiting for preparation to start.

**Preparing**: The kitchen is working on the ticket's dishes.

**Ready**: All dishes on the ticket are ready for handover or service.

**Served**: The ready dishes have been handed over to the customer or serving staff; the kitchen ticket is complete. This does not imply payment.

**Recorded cash payment**: A staff assertion that physical cash was received against a bill. It is not a payment-gateway transaction.
