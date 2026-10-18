# Counterline — full integrated product roadmap

## Outcome and authority

Build one staff-facing restaurant product for India/INR across web, native Kotlin/Compose Android and native SwiftUI iOS/iPadOS. The user explicitly requested **all** proposed capabilities, one by one, and clarified that the target is the **entire end-to-end product**, not a few services. Required scope and completion contract: `../../PRODUCT.md`.

Offline operation is confirmed and sequenced after stable online workflows. Staff-only does not exclude owner-managed customer/loyalty records; it excludes a separate customer-ordering app. Use original code/branding and evidence from public workflows. REA is an analysis/verification tool, not the application framework. No private Petpooja account/artifact or verified parity inventory exists.

## NOW — connected identity/catalog/order core

Implemented: individual staff accounts and backend-enforced roles; password/session lifecycle; owner staff administration; owner/manager base menu administration; menu/availability changes feeding real checkout; immutable server-priced demo bills; parked/open/paid history; role-limited KDS; cash settlement, attribution, transactional audit events and IST gross daily sales.

Observed evidence: real PostgreSQL HTTP checks, a 43-action browser journey spanning owner → cashier → kitchen → cashier, successful host builds, both Docker image builds, healthy full Compose startup, packaged role/API checks, and a packaged browser login/admin/logout flow. References: `FINDINGS.md` and `.local/rea-product-flow-evidence.json` / `.local/rea-packaged-product-evidence.json`.

Not complete: variants/add-ons; real venue/table/check model; native admin/KDS parity; agreed durable regression suite; public production security/tax/hardware/operations gates. The existence of a Docker stack does not finish the product.

### Immediate next connected increment

Introduce catalog choices and the running-check/table model before adding more financial behaviors. A party can submit multiple kitchen batches to one check, transfer tables and split settlement without rewriting old paid receipt snapshots, duplicating dishes/cash or losing menu/tax versions. Extend actual staff screens and the shared backend together; do not substitute unrelated CRUD endpoints for the operating journey.

Dependencies: preserve current order/receipt data; define check ownership, item/variant/add-on identity, transfer and split-allocation rules; establish outlet scoping; agree public HTTP/staff UI regression seams. Tax and legal invoice numbering still need accounting validation before live use.

Exit evidence: real table/check scenario with at least two submissions, kitchen progress, transfer, split money allocations and a reconciled final state; old standalone paid bills remain readable and unchanged. Native parity must be tracked explicitly, not inferred from web proof.

## NEXT — required online capabilities (not optional backlog)

1. **Inventory/recipes/purchasing/wastage:** canonical units and versioned recipes; deduction tied exactly once to accepted food submission; receiving, adjustments, low-stock views and movement history. Cancellation/reversal/waste policy must be explicit, not guessed.
2. **Business control:** expenses, cash shifts and closing, payment reconciliation and useful sales/item/stock reports. Financial events must reconcile; refunds/credit notes require an explicit immutable accounting policy. Existing daily gross totals are not completion of this milestone.
3. **Customer loyalty:** customer records and consent-aware history; points/offers attached to real settlements with retry-safe earning/redemption and reversal rules. No fake points for abandoned drafts.

All increments require usable screens, migrations, permission enforcement, persistence and recovery behavior connected to the existing operating flow. Introduce capabilities in that sequence rather than building detached service demos.

## REQUIRED AFTER ONLINE — offline continuity

Local menu/order storage, registered device identity, versioned prices/taxes/recipes, durable command outbox, safe replay, conflict handling and reconciliation. Decide internet outage versus local-network outage behavior and legal offline invoice numbering. Demonstrate interrupted sync and duplicate prevention across devices. Never infer online payment success from an offline client assertion.

## Cross-platform and pilot gates

- Native Android/iOS must cover the intended staff flows, not only the current takeaway checkout. Real phones are available; Android SDK location remains unconfigured, and Mac/Xcode/signing access is not established.
- Configure trusted HTTPS for remote/phone use. Add outlet/tenant isolation, security review, recovery/MFA/idle-session decisions, monitoring and backup/restore verification before public exposure.
- Validate actual printers/drawers, accessibility, mobile lifecycle, tax policy, GSTIN/fiscal numbering, invoice/credit-note handling and failure recovery.
- Payment gateways and delivery integrations require provider access/approval and a separately selected scope; local recorded cash is not digital payment processing.

## Direction beyond the core

Multi-outlet operational management and authorized external integrations can build on verified isolation/accounting rules. Do not invent feature-parity claims, dates, commercial access, external deployment authority or app-store readiness.

## Major risks

- Prototype immutable bills are not running checks; expanding table/split workflows requires a deliberate financial model.
- Public marketing pages do not establish private app behavior or backend implementation.
- A configurable demo GST rate is not legal compliance.
- Offline multi-device identity, numbering and reconciliation are architectural work, not caching.
- Native toolchains/signing, hardware and external provider access are independent verification dependencies.
