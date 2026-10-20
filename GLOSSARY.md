# Restaurant operations

The language of staff ordering, billing and kitchen work in Counterline. Payment and food preparation are separate activities.

## Language

**Tenant**: An independent restaurant business using Counterline, with its own staff, restaurant records and financial history.
_Avoid_: Outlet (a business location, not an independent business)

**Outlet**: One restaurant location operated by a tenant. A business can have several outlets.

**Business code**: The operator-assigned name used to open a tenant's staff workspace. Knowing the code does not grant access.

**Staff account**: An individual employee's named access to restaurant work, governed by a role and active status. Disabling it does not erase the employee's historical actions.

**Owner**: The restaurant operator who controls staff access and all supported business operations.

**Manager**: A staff member who manages the menu and restaurant operations without administering other staff accounts.

**Cashier**: A staff member who takes orders and records received cash, and can read kitchen progress without changing it.

**Kitchen staff**: Staff who prepare and hand over dishes without access to receipt prices, cash amounts or sales reports.

**Ingredient**: A stock-tracked material used to prepare dishes, measured in a fixed base unit.

**Recipe**: The ingredient quantities needed for one serving of a base dish, variant or add-on.

**Stock movement**: A recorded increase or decrease in an ingredient's quantity, with its cause and responsible staff member.

**Stock receipt**: Ingredients physically received into the restaurant's stock. It is not a customer payment receipt or a supplier payable invoice.

**Supplier**: A business or person from whom the restaurant obtains ingredients.

**Purchase order**: A restaurant's recorded request to a supplier for specified ingredient quantities. It is not evidence that stock arrived or that a supplier bill was paid.

**Delivery receipt**: An attributable record of ingredients actually received against a purchase order, including a partial delivery.
_Avoid_: Supplier bill (a request for payment)

**Supplier bill**: A supplier's request for payment recorded as an amount the restaurant owes. It is distinct from a customer bill, purchase order or physical delivery receipt.

**Recorded supplier payment**: A staff assertion that money was already paid to a supplier against a supplier bill. It is not an instruction to transfer money or confirmation from a payment provider.

**Outstanding supplier balance**: The amount still owed on supplier bills after recorded payments and excluding void bills.

**Overdue supplier balance**: An outstanding supplier amount whose due date has passed. A bill due today is not yet overdue.

**Voided supplier bill**: A retained, unpaid supplier bill explicitly withdrawn from the restaurant's outstanding liabilities. Voiding is not a goods return or payment refund.

**Unreceived remainder**: The ordered quantities not yet received. Closing this remainder ends further receiving against that order without returning stock already received.

**Wastage**: Ingredients lost or discarded outside preparation recorded against an accepted food submission.

**Stock adjustment**: An explained correction to recorded stock, including an opening balance.

**Physical stock count**: A staff observation of the quantities physically present for selected ingredients at a point in time.
_Avoid_: Stock receipt (a delivery, not a count)

**Stock variance**: The difference between a physically counted quantity and the recorded quantity being checked.

**Stock reconciliation**: An explained correction that brings recorded stock into agreement with a physical count while retaining the original difference.

**Stock shortage**: A required ingredient quantity exceeding the recorded quantity available. It is a warning, not automatic proof that the dish is physically unavailable.

**Recipe coverage**: Whether explicit ingredient requirements are mapped for the selected dish, variant and add-ons.

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
