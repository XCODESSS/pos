# Decisions

## D-001 — Online first; offline remains required

Date: 2026-10-16. Status: accepted (user direction).

Build and demonstrate online checkout before implementing offline sales/synchronization. Retain client-generated order UUIDs, server-side idempotency, integer paise and bill snapshots now. Trade-off: an internet failure still blocks sales; retry recovery must not be advertised as offline support. Revisit when M1/M2 gates support an offline protocol and invoice-numbering decision.

## D-002 — Staff-facing India scope

Date: 2026-10-16. Status: accepted (user direction).

India/INR, Android in Kotlin/Compose, iOS/iPadOS in SwiftUI, staff-facing POS only. No customer-facing app. Demo calculations separate CGST/SGST; production GST policy is unresolved and needs validation.

## D-003 — Separate application from REA

Date: 2026-10-16. Status: accepted for this implementation.

Keep REA source/fork at `../rea` unchanged; put original POS sources in this directory. REA performs bounded public browser observations via its version-pinned CLI; do not register global MCP clients or inspect private systems without a selected authorized target. The user's REA fork is origin, original REA is upstream. No application Git remote, commit or push has been created.

Rationale: REA is an analysis tool, not a POS framework. Trade-off: the application needs its own repository later. Revisit only if the user selects a repository/layout change.

## D-004 — Shared online module, native client adapters

Date: 2026-10-16. Status: accepted for development, not a production architecture freeze.

Kotlin/Ktor + PostgreSQL owns prices, demo taxes, bill snapshots and settlement. React/TypeScript web, native Compose Android and SwiftUI iOS consume one HTTP interface. Prefer a single deployable backend over premature microservices.

Trade-off: separate UI implementations; mobile contracts must remain compatible. At this stage the single-outlet shared token was intentionally development-only. Its authentication portion was superseded by D-007 on 2026-10-17; outlet/device isolation and production gates remain outstanding.

## D-005 — Food preparation is independent of payment

Date: 2026-10-16. Status: accepted for the online development increment; restaurant-specific operating policies remain to be validated.

Context: food can be prepared before cash is collected, and a prepaid takeaway may still be queued. Treating PAID as kitchen completion would lose active work.

Decision: retain separate payment and kitchen states. New order creation atomically queues one ticket; ticket creation replays do not dispatch another. Preparation follows QUEUED → PREPARING → READY → SERVED under row locking and an expected version. Exact previous transitions are retryable; later/stale commands require reconciliation, never automatic version substitution.

Migration choice: existing orders have unknown kitchen history. Leave them without tickets instead of guessing that they are queued or served; preserve all bill/payment data. Trade-off: old demo orders cannot be prepared through KDS without a future explicit migration/reissue workflow.

Web parking merely sets aside a persisted open bill; it is not a new payment state and does not suspend its kitchen ticket. History uses bounded keyset pages; KDS polling is explicitly not an offline or real-time push guarantee. The initial increment did not imply role enforcement; D-007 subsequently added individual identity and permissions. Item-level routing, recall, cancellation and add-on KOT policy remain unresolved. Revisit before real restaurant pilot use and any order-editing workflow.

## D-006 — One full product, not disconnected service demos

Date: 2026-10-17. Status: accepted (explicit user direction).

Deliver all proposed capabilities in sequence, integrated through real staff workflows: identity/catalog, tables/running checks, inventory/recipes/purchases/wastage, business reports/expenses/shift closing, customer loyalty, offline continuity and web/native parity. `../../PRODUCT.md` is the delivery contract. Completing individual endpoints or a packaged core does not complete the product.

Preserve a single modular Kotlin backend and common PostgreSQL data/rules rather than introducing microservices. Add UI, permissions, persistence and recovery with each connected increment. Trade-off: a larger multi-milestone build; native/toolchain, tax, hardware and operational gates must remain visible rather than being replaced with unverified success claims.

## D-007 — Individual persisted identity and authoritative role checks

Date: 2026-10-17. Status: accepted for the integrated development core; deployment security/provider choices remain review gates.

Replace shared-token authentication entirely with named accounts, salted PBKDF2-HMAC-SHA256 verification and independently random opaque sessions stored only as hashes. Sessions expire after eight hours, survive process/container restart and consult current account role/active state on every request. Staff/password changes revoke sessions; typed owner updates and resets are version-guarded. No static-token compatibility bypass remains.

Use explicit cashier/kitchen/manager permissions, owner-only staff administration and a price-free kitchen projection. Manager permissions are enumerated rather than silently inheriting every future permission. Initial owner bootstrap runs only on an empty staff table, rejects the example placeholder and never resets an existing credential.

Rationale: common HTTP identity works for web and native clients; persisted sessions support immediate subsequent-request revocation without embedding stale roles in stateless JWTs. New financial actions carry staff attribution and audit events in the same transaction. Older anonymous records stay unknown. Menu edits govern future order prices only; historical snapshots are immutable.

Trade-offs: additional DB lookup per authenticated request; memory-only web bearer tokens still require XSS/CSP/TLS review; JDK PBKDF2 is a portable initial implementation, while OWASP prefers Argon2id for new systems. No MFA, idle-expiry, forced initial rotation, self-service owner recovery, tenant isolation or tamper-evident audit guarantee is implied. Revisit before public pilot/device/offline authorization work; see `../IDENTITY.md`.
