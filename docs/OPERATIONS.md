# Local staging, release and recovery

This is a pre-production foundation, not approval to run real restaurants. All commands run from `pos/`. Development, verification and staging are separate Compose projects and databases; never copy development financial records into another environment.

## Tenant and environment model

- A tenant is an independent business; current workflow support is one outlet per business.
- `/t/{business-code}/api` selects an operator-registered runtime/database. There is no `/api` fallback, public tenant inventory, self-service signup or arbitrary JDBC selection.
- `TENANTS_JSON` is a secret JSON array of `{id,slug,jdbcUrl,username,password,ownerUsername,ownerPassword}`. IDs are immutable canonical UUIDs; slugs are 3–63 lowercase characters, starting with a letter. Maximum 32 configured businesses, three connections per pool per application instance. Capacity beyond that needs a reviewed control plane/pooling design.
- Verification/staging require explicit registry configuration and nonsuperuser roles without CREATEDB, CREATEROLE or BYPASSRLS. Databases must revoke PUBLIC CONNECT and grant it only to their own tenant role. Runtime currently uses the database-owning migration role; separating migrations from runtime DDL privileges remains a production gate.
- V5 binds every database to one immutable tenant ID and `development`, `verification` or `staging`. Mismatches fail before listening. Do not edit this marker to repurpose business data. `production` is deliberately unsupported until release gates are implemented.
- Fresh non-development databases remove only the exact, untouched V1 demo dishes before owner bootstrap. Applied V1–V4 migrations remain unchanged. Populated unbound non-development databases are refused, not cleaned or reset.
- In development only, `.env` supplies the legacy database and first owner, assigned to business `demo`. Existing passwords/data remain unchanged. Never reuse its credentials in staging.

## Daily verification

Prerequisites: Node 22.19+, Docker/Compose. Backend/web image builds supply their own JDK/Node build environments.

```sh
node verification/run.mjs
```

The runner creates `counterline-verify-<random>`, two databases with separate roles/passwords, random loopback ports and a private volume. It performs public HTTP checks, identity-mismatch probes and a real `pg_dump` → fresh database → `pg_restore` drill. Financial assertions inspect the public interface, not private database tables. Only the generated project/volume and temporary files are removed afterward. Do not override its project identity or redirect the tests at development/staging.

Database isolation is not the only test: the suite checks server pricing, immutable receipts, duplicate/concurrent commands, stale versions, kitchen permissions, split-cash reconciliation and restored sessions/reports. It is not a security audit, full migration-upgrade matrix or load test.

For browser evidence, supply an already installed REA 6.5.0 CLI and Chrome executable:

```sh
# Set these to your installed absolute paths; do not install a global MCP server.
export REA_CLI=/absolute/path/to/rea-agents/scripts/rea.mjs
export REA_CHROME=/absolute/path/to/chrome
node verification/run.mjs --browser
```

The runner also observes three REA scenarios: menu choices through two kitchen batches/transfer/split settlement, a 390px receipt recovery, and tenant switching with another business's recovery key present. Passwords are environment-backed declared secrets; tokens stay in memory. Ignored evidence/screenshots are under `verification/.artifacts/<run-project>/`. This is desktop Chrome, not physical Android/iPhone verification. Without `--browser`, the HTTP/recovery gates still run but UI evidence is not produced.

## Promote the actual verified images

Commit a clean source tree first. From Bash/Git Bash:

```sh
node verification/run.mjs --browser --release-tag="$(git rev-parse --short HEAD)"
```

This refuses a dirty worktree, missing browser verification, a different commit hash or existing release tags. Only after all gates pass does it tag the **same tested image objects** as `counterline-backend:<commit>` and `counterline-web:<commit>`. It does not rebuild a different image for staging or push anything. `release.json` records source commit and image IDs in the ignored run artifacts. Retain the image IDs (or registry digests for a future hosted pipeline); a tag by itself is not a signed provenance/registry immutability guarantee. CI is configured for build/HTTP/recovery checks only and has not run remotely without a repository remote/push.

## Start separate synthetic staging

Use the commit tag produced by the release command, not an arbitrary rebuild:

```sh
node ops/configure-staging.mjs counterline-backend:COMMIT counterline-web:COMMIT
docker compose --env-file .env.staging -f compose.staging.yaml up -d --wait
docker compose --env-file .env.staging -f compose.staging.yaml ps
```

Replace `COMMIT` with that literal verified tag. The generator creates ignored `.env.staging` with independent random database/admin/owner credentials and a tenant UUID. It refuses overwrites; changing environment variables does not reset existing database users or staff passwords. Protect the file using OS permissions; production credentials need a reviewed secret manager/rotation workflow.

Open `http://127.0.0.1:18088/t/stage-demo/`. Find the generated `stage-owner` credentials in your local secret file, never in Git or chat. Expect an empty catalog and zero sales. The staging database/backend have no host ports; web binds loopback only. The separate `counterline-staging_staging-data` volume survives restarts.

```sh
# Stop while preserving data:
docker compose --env-file .env.staging -f compose.staging.yaml stop
```

Do not use `down -v` on development/staging. The verification runner's scoped volume deletion is intentionally different. Staging currently provisions one synthetic business; additional businesses require explicit separate databases/roles and registry entries, not shared tables or a change to existing identities.

## Migration and rollback procedure

1. Keep the current release image IDs, source commit, environment/tenant registry and a verified backup for **each** tenant. Know the last successful restore time.
2. Verify the proposed release in an isolated stack, including an upgrade rehearsal on a sanitized copy at the deployed schema version. The current suite covers fresh V1→V5 and restore-to-V5, not every future upgrade.
3. In a maintenance window, stop mutations before backing up/migrating; verify database/tenant identity and backup integrity. Do not expose startup migration errors publicly.
4. Start the selected backend image. Current startup migrates registered tenant databases sequentially and fails the application if any tenant fails; it is not zero-downtime fleet migration. Expand/contract migrations and an independent migrator remain production requirements.
5. Check `/health`, `/ready`, tenant login, a nonfinancial read and reconciliation. Reload Nginx's upstream resolution after recreating the backend: `docker compose --env-file .env.staging -f compose.staging.yaml exec -T web nginx -s reload`.
6. Roll the application back only when the previous binary is compatible with the migrated schema. Never run Flyway clean or edit an applied migration checksum. For incompatible schema changes, restore into a **new** database and reconcile any accepted post-backup writes before switching; do not overwrite the active volume.

## Backup/restore runbook

The automated drill uses only disposable synthetic databases. Real operations additionally need encrypted off-host backups, retention, monitored schedules, recovery-point/recovery-time objectives, point-in-time recovery and controlled access.

For a local staging snapshot, avoid PowerShell binary redirection. Use PostgreSQL's file output inside the container, then copy the file out:

```sh
mkdir -p .local/backups
docker compose --env-file .env.staging -f compose.staging.yaml exec -T db pg_dump -U tenant_stage --format=custom --file=/tmp/tenant-stage.dump tenant_stage
# Obtain the db container ID with the same staging Compose command's `ps -q db`,
# then use `docker cp CONTAINER_ID:/tmp/tenant-stage.dump .local/backups/tenant-stage.dump`.
```

Treat dumps as secrets: they contain staff password/session hashes and business history. Restore only into a freshly provisioned scratch database owned by the intended tenant role, using `pg_restore --exit-on-error --no-owner --no-privileges`; validate marker, receipt totals, payment counts and reports before considering a switch. A successful dump is not proof of recoverability.

A disaster restore can revive sessions/revocations as of the backup. The automated drill deliberately checks session persistence as a data-integrity property; production recovery must revoke all restored sessions before reopening access and require fresh sign-in. Do not confuse historical session preservation with an approved access-recovery policy.

## Still required before a production pilot

- Tenant lifecycle/onboarding/offboarding, subscription/access policy and multi-outlet memberships/permissions.
- Separate migration/runtime privileges; trusted HTTPS/ingress/proxy configuration; production secret rotation, account recovery/MFA/idle policy; XSS/CSP/security review, isolation-abuse and load testing.
- Real monitoring/alerts/error correlation, audit access/tamper-resistance policy, restore objectives and an operator incident/support process. Existing readiness/logs are groundwork, not a hosted monitoring implementation.
- Validated India GST/fiscal numbering/credit-note/refund policy; current receipts remain demo bills and cash recording is not digital payment processing.
- Inventory/recipes/purchases/wastage, shifts/expenses/reconciliation, loyalty and offline continuity from the full product contract.
- Successful native builds, complete native workflows, physical phones, printers/drawers, accessibility and failure-recovery checks.

No hosting, public TLS, external payment provider, app signing, live restaurant use or cloud account provisioning is authorized by this runbook.
