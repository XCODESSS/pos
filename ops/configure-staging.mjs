import { randomBytes, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const [backend, web, slug = 'stage-demo'] = process.argv.slice(2);
if (![backend, web].every(value => value && /^[a-zA-Z0-9][a-zA-Z0-9._/:@-]+$/.test(value)) || !/^[a-z][a-z0-9-]{2,62}$/.test(slug)) {
  throw new Error('Usage: node ops/configure-staging.mjs BACKEND_IMAGE WEB_IMAGE [business-code]');
}
const secret = () => randomBytes(32).toString('hex');
const dbPassword = secret();
const registry = [{ id: randomUUID(), slug, jdbcUrl: 'jdbc:postgresql://db:5432/tenant_stage', username: 'tenant_stage', password: dbPassword, ownerUsername: 'stage-owner', ownerPassword: secret() }];
const content = [
  '# Local synthetic staging only. Keep this file secret; never commit it.',
  `BACKEND_IMAGE=${backend}`, `WEB_IMAGE=${web}`, `DB_ADMIN_PASSWORD=${secret()}`,
  `STAGING_DB_PASSWORD=${dbPassword}`, `TENANTS_JSON=${JSON.stringify(registry)}`, '',
].join('\n');
const target = fileURLToPath(new URL('../.env.staging', import.meta.url));
try { await writeFile(target, content, { flag: 'wx', mode: 0o600 }); }
catch (cause) { if (cause.code === 'EEXIST') throw new Error('Refusing to overwrite .env.staging or reset existing credentials/tenant identity.'); throw cause; }
console.log('Created ignored .env.staging with generated credentials. No service was started. Protect the file with your operating-system permissions.');
