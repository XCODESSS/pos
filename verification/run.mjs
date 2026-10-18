import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readdir, mkdir, writeFile } from 'node:fs/promises';
import { waitReady } from './health.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const composeFile = fileURLToPath(new URL('./compose.yaml', import.meta.url));
const composeEnvironment = fileURLToPath(new URL('./compose.env', import.meta.url));
const project = `counterline-verify-${randomBytes(6).toString('hex')}`;
const secret = () => randomBytes(24).toString('hex');
const environment = {
  ...process.env, VERIFY_PROJECT: project, VERIFY_DB_PASSWORD: secret(),
  VERIFY_OWNER_USERNAME: 'verify-owner', VERIFY_OWNER_PASSWORD: secret(),
  COUNTERLINE_VERIFICATION: 'isolated', VERIFY_TENANT_PATH: '/t/alpha',
  VERIFY_ALPHA_DB_PASSWORD: secret(), VERIFY_BETA_DB_PASSWORD: secret(),
};
environment.VERIFY_TENANTS_JSON = JSON.stringify(['alpha', 'beta'].map((slug, index) => ({
  id: index === 0 ? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' : 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', slug,
  jdbcUrl: `jdbc:postgresql://db:5432/tenant_${slug}`, username: `tenant_${slug}`,
  password: slug === 'alpha' ? environment.VERIFY_ALPHA_DB_PASSWORD : environment.VERIFY_BETA_DB_PASSWORD,
  ownerUsername: environment.VERIFY_OWNER_USERNAME, ownerPassword: environment.VERIFY_OWNER_PASSWORD,
})));
const secrets = [environment.VERIFY_DB_PASSWORD, environment.VERIFY_OWNER_PASSWORD, environment.VERIFY_ALPHA_DB_PASSWORD, environment.VERIFY_BETA_DB_PASSWORD];
const redact = text => secrets.reduce((result, value) => result.replaceAll(value, '<REDACTED>'), text);
let active; let interrupted = false; let created = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { interrupted = true; active?.kill('SIGTERM'); });

function run(command, args, { quiet = false, allowFailure = false, timeoutMs = 600_000, cwd = root } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
    active = child; let output = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    for (const stream of [child.stdout, child.stderr]) stream.on('data', data => {
      const text = data.toString(); output = (output + text).slice(-120_000);
      if (!quiet) process.stdout.write(redact(text));
    });
    child.on('error', cause => { clearTimeout(timer); reject(cause); });
    child.on('close', code => {
      clearTimeout(timer);
      if (active === child) active = undefined;
      const result = { code: code ?? 1, output: redact(output) };
      if (result.code !== 0 && !allowFailure) reject(new Error(`${command} failed (${result.code})${quiet ? `\n${result.output}` : ''}`)); else resolve(result);
    });
  });
}
const compose = (args, options) => run('docker', ['compose', '--env-file', composeEnvironment, '--project-name', project, '--file', composeFile, ...args], options);

try {
  console.log(`Verification owns disposable project ${project}; development .env is not loaded.`);
  const revision = (await run('git', ['rev-parse', 'HEAD'], { quiet: true })).output.trim();
  environment.VERIFY_SOURCE_REVISION = revision;
  const releaseTag = process.argv.find(value => value.startsWith('--release-tag='))?.slice('--release-tag='.length);
  if (releaseTag !== undefined) {
    if (!/^[a-f0-9]{7,40}$/.test(releaseTag) || !revision.startsWith(releaseTag) || !process.argv.includes('--browser')) throw new Error('Release tagging requires the current commit hash and --browser verification.');
    const status = await run('git', ['status', '--porcelain'], { quiet: true });
    if (status.output.trim()) throw new Error('Commit the source first; release tagging refuses a dirty worktree.');
    for (const service of ['backend', 'web']) {
      const existing = await run('docker', ['image', 'inspect', `counterline-${service}:${releaseTag}`], { quiet: true, allowFailure: true });
      if (existing.code === 0) throw new Error('Release tags already exist; refusing to overwrite verified artifacts. Reuse them or create a new source commit.');
    }
  }
  if (process.argv.includes('--host-backend')) {
    console.log('Explicit host-backend mode: rebuilding the distribution with host Gradle in offline mode.');
    const windows = process.platform === 'win32';
    await run(windows ? 'cmd.exe' : './gradlew', windows ? ['/d', '/c', 'gradlew.bat', '--offline', '--no-daemon', 'installDist'] : ['--offline', '--no-daemon', 'installDist'], { cwd: fileURLToPath(new URL('../backend/', import.meta.url)), quiet: true });
    environment.VERIFY_BACKEND_DOCKERFILE = 'Dockerfile.host';
  }
  created = true;
  await compose(['build'], { quiet: true });
  if (interrupted) throw new Error('Verification interrupted.');
  await compose(['up', '-d', '--wait', '--wait-timeout', '120'], { quiet: true });
  const port = await compose(['port', 'web', '80'], { quiet: true });
  const address = port.output.trim();
  if (!/^127\.0\.0\.1:\d+$/.test(address)) throw new Error('Unexpected verification port mapping.');
  environment.VERIFY_BASE_URL = `http://${address}`;
  await waitReady(environment.VERIFY_BASE_URL);
  const files = (await readdir(new URL('./', import.meta.url))).filter(name => name.endsWith('.test.mjs')).sort((a, b) => a === 'environment.test.mjs' ? -1 : b === 'environment.test.mjs' ? 1 : a.localeCompare(b));
  if (!files.length) throw new Error('No acceptance cases found.');
  if (files.includes('environment.test.mjs')) await run(process.execPath, ['--test', 'verification/environment.test.mjs']);
  await run(process.execPath, ['--test', '--test-concurrency=1', ...files.filter(name => !['environment.test.mjs', 'recovery.test.mjs'].includes(name)).map(name => `verification/${name}`)]);
  // Misconfiguration probes use disposable one-off containers, not the running service.
  const registry = environment.VERIFY_TENANTS_JSON;
  environment.VERIFY_APP_ENV = 'staging';
  const wrongEnvironment = await compose(['run', '--rm', '--no-deps', '-T', 'backend'], { quiet: true, allowFailure: true, timeoutMs: 20_000 });
  delete environment.VERIFY_APP_ENV;
  if (wrongEnvironment.code === 0 || !wrongEnvironment.output.includes('identity mismatch')) throw new Error('Wrong-environment startup was not rejected for the expected reason.');
  const aliased = JSON.parse(registry); aliased[0].id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  environment.VERIFY_TENANTS_JSON = JSON.stringify(aliased);
  const wrongTenant = await compose(['run', '--rm', '--no-deps', '-T', 'backend'], { quiet: true, allowFailure: true, timeoutMs: 20_000 });
  environment.VERIFY_TENANTS_JSON = registry;
  if (wrongTenant.code === 0 || !wrongTenant.output.includes('identity mismatch')) throw new Error('Wrong-tenant startup was not rejected for the expected reason.');
  console.log('Startup probes: mismatched tenant/environment identities rejected.');
  const crossDatabase = await compose(['exec', '-T', 'db', 'sh', '-c', 'PGPASSWORD="$VERIFY_ALPHA_DB_PASSWORD" psql -h 127.0.0.1 -U tenant_alpha -d tenant_beta -c "SELECT 1"'], { quiet: true, allowFailure: true });
  if (crossDatabase.code === 0 || !crossDatabase.output.includes('permission denied for database')) throw new Error('Tenant database role did not deny cross-database CONNECT as expected.');
  console.log('Database role probe: cross-tenant CONNECT denied.');
  await run(process.execPath, ['verification/backup-roundtrip.mjs']);
  if (process.argv.includes('--browser')) await run(process.execPath, ['verification/browser.mjs']);
  if (releaseTag !== undefined) {
    const images = {};
    for (const service of ['backend', 'web']) {
      const tag = `counterline-${service}:${releaseTag}`;
      await run('docker', ['tag', `${project}-${service}`, tag], { quiet: true });
      images[service] = { tag, id: (await run('docker', ['image', 'inspect', '--format', '{{.Id}}', tag], { quiet: true })).output.trim() };
    }
    const output = new URL(`./.artifacts/${project}/`, import.meta.url);
    await mkdir(output, { recursive: true });
    await writeFile(new URL('release.json', output), JSON.stringify({ revision, project, backendBuild: process.argv.includes('--host-backend') ? 'host-offline' : 'container', images }, null, 2));
    console.log(`Promoted the tested images locally as counterline-backend:${releaseTag} and counterline-web:${releaseTag}. No push.`);
  }
} catch (cause) {
  console.error(redact(cause instanceof Error ? cause.message : String(cause)));
  process.exitCode = interrupted ? 130 : 1;
  if (created) {
    const logs = await compose(['logs', '--no-color', '--tail', '30', 'backend'], { quiet: true, allowFailure: true }).catch(() => null);
    if (logs) process.stderr.write(logs.output);
  }
} finally {
  if (created) {
    console.log(`Removing only runner-owned containers/volume for ${project}.`);
    const cleanup = await compose(['down', '--volumes', '--remove-orphans'], { quiet: true, allowFailure: true }).catch(() => null);
    if (!cleanup || cleanup.code !== 0) { console.error('Verification cleanup failed; inspect the named project.'); process.exitCode = 1; }
    await run('docker', ['image', 'rm', `${project}-backend`, `${project}-web`], { quiet: true, allowFailure: true }).catch(() => {});
  }
}
