# Staff identity — current development policy

This is an integrated single-outlet identity module, not a production identity provider or multi-tenant SaaS. The route permission matrix is in `API.md`.

## Bootstrap and staff lifecycle

- The first owner is created only when the staff table is empty, using `OWNER_USERNAME` and `OWNER_PASSWORD`. There are no built-in default credentials, public signup or shared-token bypass.
- Subsequent startups do not change existing account passwords. If staff exist but no active owner remains, startup fails closed rather than manufacturing a new owner. Do not use environment editing as a password-recovery mechanism.
- Owners create named staff accounts, edit display names/roles/active state, and reset other staff passwords. The current development outlet is capped at 100 accounts, including disabled accounts.
- An owner cannot disable or demote itself. Owner administration is serialized and rechecks the actor's active-owner status, so concurrent owner edits cannot remove the final acting owner through the supported interface.
- No account deletion erases historical order/payment attribution. Disabling an account revokes its sessions and prevents login; reactivation does not change its password.
- Password resets are version-guarded. An exact immediate replay returns success without re-revoking sessions; a later version/password change cannot be overwritten by a stale retry.

## Password and session storage

- Passwords: 12–128 UTF-16 code units, nonblank; no silent trimming or composition rule. Initial passwords should be shared securely and changed by staff using Your account. Forced first-login rotation and self-service owner recovery are not implemented yet.
- Hashing: JDK `PBKDF2WithHmacSHA256`, 600,000 iterations, independent 16-byte random salts, 32-byte output, constant-time verifier comparison. Encoded format includes algorithm/iteration/salt/hash metadata; no plaintext passwords or fast password fingerprints are stored in the database/audit events.
- At most four password derivations execute concurrently; excess attempts receive 429 rather than creating an unbounded hashing queue. Password material in PBEKeySpec is cleared after derivation; this is not a memory-forensics guarantee for immutable request strings.
- Sessions: independently generated 256-bit opaque random tokens. Only SHA-256 token hashes are stored server-side. The browser and native sources keep access tokens in memory, not their checkout journals. The server checks current account role, active state and expiry for every authenticated request.
- Absolute expiry: eight hours, enforced server-side. Browser also prompts for sign-in on expiry/401. Logout removes the current session; password changes/resets and account updates revoke all target sessions. Persisted sessions survive backend restart until expiry/revocation.
- Revocation governs subsequent requests, not rollback of an already-authorized transaction. No idle expiry, refresh-token protocol, device-bound sessions, MFA or SSO is implemented yet.

## Login abuse and response limits

Login attempts (successful or not) are counted in atomic persisted 15-minute windows: 30 per normalized username, 200 per observed source address. Older bucket records expire from storage after 24 hours. Bucket keys are hashes, not a claim of irreversible anonymization. Nonexistent, disabled and wrong-password accounts use the same credential error and still perform password verification work.

The source address is the actual connection peer; forwarded headers are not trusted automatically. Behind a proxy many users may share a bucket. A trusted-proxy/abuse policy needs explicit deployment work before public exposure. Request bodies are capped at 64 KiB; sensitive API responses use no-store. None of these controls substitutes for TLS, XSS/CSP review, denial-of-service testing or monitoring.

## Business permissions and attribution

Owner manages staff; manager manages menu and operations; cashier handles checkout/cash and can only read KDS; kitchen prepares tickets without menu prices, receipt totals, cash or sales reports. Hiding navigation is not the security control—the backend enforces permissions independently.

New orders record the creating staff ID; cash settlements record the receiving staff ID. Transactional audit events cover successful identity/catalog/order mutations. Replays do not duplicate financial attribution/events. Historical anonymous records remain null; do not infer that the initial owner performed old actions. The current audit table is internal, not a tamper-evident accounting ledger or a finished audit-viewer feature.

## Recovery limits and release gates

Web checkout IDs remain in session storage; the same authorized outlet staff can recover persisted bills after reauthentication. On expiry, same-user reauthentication preserves the mounted counter state; explicit sign-out warns before discarding an unsaved cart. Admin/kitchen unknown-command state is held while its workspace is open, not in a durable offline outbox. After navigation/reload, reconcile with server records before creating a new intent. Native journals retain IDs but not credentials; native UI parity and real-device behavior remain unverified.

Before a pilot: review the password-provider choice (OWASP prefers Argon2id for new systems), introduce outlet/tenant isolation, decide first-password rotation and sole-owner recovery, configure trusted TLS and proxy rules, add agreed regression checks, security review, backups/restores, operational monitoring and mobile verification. PBKDF2 selection here is a portable JDK trade-off, **not** a FIPS/compliance certification.

## Sources checked 2026-10-17

- OWASP Password Storage Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html — preferred memory-hard algorithms, PBKDF2-HMAC-SHA256 work-factor guidance, salt handling.
- OWASP Session Management Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html — opaque random identifiers, one-way server storage, server-side expiry and revocation.
- Ktor 3.2.3 RequestBodyLimit source: https://raw.githubusercontent.com/ktorio/ktor/3.2.3/ktor-server/ktor-server-plugins/ktor-server-body-limit/common/src/io/ktor/server/plugins/bodylimit/RequestBodyLimit.kt — content-length and streamed body limiting interface used by this server.
