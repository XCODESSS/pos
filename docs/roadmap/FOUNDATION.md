# Evolutionary prototype foundation

User direction, 2026-10-18: retain the existing product as an evolutionary prototype, establish a safe route through pre-production to production, plan and execute the groundwork, use REA when useful, and use local Git commits/branches without pushing.

## Current milestone

Make the existing online product reproducibly verifiable and safely runnable in an isolated, production-like staging environment. Keep the Kotlin modular monolith, PostgreSQL, web and native client architecture. Do not add more business features during this foundation milestone.

## Acceptance conditions

- The application has its own Git repository on `main`, an honest initial snapshot and subsequent small commits on a foundation branch. No remote or push; credentials, local evidence and generated outputs remain ignored.
- A single Node command creates an isolated verification stack with random credentials/ports, drives the public HTTP interface, returns nonzero on failures and removes only resources it created. Existing development data is never used for automated tests.
- Public identity, menu, order, kitchen, table/check and cash/report interfaces are the regression seams. Staff browser workflows are the UI seam. No private-method/database-state assertions. These follow the verification approach discussed with the user; the user authorized planning and execution of this foundation.
- Known-correct INR examples, role denials, retries, concurrent duplicate requests, stale versions, snapshot preservation and split-payment reconciliation are executable checks. Tests are added one vertical slice at a time.
- REA observes actual staff UI interactions through its pinned local CLI, with environment-backed secret redaction. Record scope and limitations; no claim that a screenshot alone proves correctness.
- Confirmed scope: multi-tenant SaaS. Tenant means an independent restaurant business; an outlet is a location within that business. Initially use one database per tenant behind one shared application. Registered tenant paths select an allowlisted runtime; sessions, browser journals and all domain records stay tenant-scoped. Verify two businesses with the same staff usernames and dish IDs cannot cross-access data or use each other's tokens.
- Development, verification and staging have separate credentials, database volumes and configuration. A database is bound to one environment and immutable tenant identity. Non-development fresh installations have no demo menu. Applied migrations are never rewritten.
- Staging uses the exact locally tested application images, loopback networking and separate persistence. No cloud deployment, public ingress, account provisioning or external provider integration.
- CI runs the same verification command and production builds. Operators have concrete migration, backup/restore, release and rollback procedures. A restore drill runs only against disposable verification databases.
- Native toolchain, tenant/outlet isolation, tax/invoice policy, HTTPS, recovery/security review, monitoring and real hardware remain explicit production gates. A staging stack is not a production certification.

## SaaS architecture and remaining decisions

Multi-tenant SaaS was confirmed by the user on 2026-10-18. Initial isolation is database-per-tenant, with a bounded explicit startup registry, separate database credentials and `/t/{slug}/api` routing. No unauthenticated default-tenant fallback or arbitrary database provisioning is exposed. Existing prototype data belongs to the development demo business only.

This deliberately trades higher database/migration overhead for a smaller, auditable isolation surface and reuse of the current modules. Revisit before a large tenant fleet; do not silently replace it with shared tables lacking enforced tenant scope. Automated signup, subscriptions, tenant lifecycle administration, multi-outlet memberships and fleet migration automation remain separate SaaS delivery gates. Staging remains one outlet per synthetic tenant, local-only.

## Out of scope for this milestone

Inventory, expenses/shifts, loyalty and offline remain required in the product roadmap, but do not enter this foundation milestone. No production deployment, real cash, external payments, mobile signing, commit-history reconstruction or automatic push.
