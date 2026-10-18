import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { api, dish, login, uuid } from './http.mjs';
import { waitReady } from './health.mjs';

const project = process.env.VERIFY_PROJECT;
assert.match(project ?? '', /^counterline-verify-[a-f0-9]{12}$/, 'only a runner-owned disposable project may run this drill');
const file = fileURLToPath(new URL('./compose.yaml', import.meta.url));
const prefix = ['compose', '--env-file', fileURLToPath(new URL('./compose.env', import.meta.url)), '--project-name', project, '--file', file];
const environment = { ...process.env };
async function compose(args) {
  try { return await promisify(execFile)('docker', [...prefix, ...args], { env: environment, timeout: 120_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }); }
  catch { throw new Error('Disposable recovery infrastructure command failed. Inspect the runner-owned project logs.'); }
}
async function transfer(args, path, direction) {
  const child = spawn('docker', [...prefix, 'exec', '-T', 'db', ...args], { env: environment, stdio: [direction === 'restore' ? 'pipe' : 'ignore', direction === 'dump' ? 'pipe' : 'ignore', 'pipe'], windowsHide: true });
  const timer = setTimeout(() => child.kill('SIGTERM'), 60_000);
  child.stderr.on('data', () => {}); // Do not echo SQL/environment values into artifacts.
  const completion = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`Disposable ${direction} command failed.`)));
  });
  const stream = direction === 'dump' ? pipeline(child.stdout, createWriteStream(path, { flags: 'wx', mode: 0o600 })) : pipeline(createReadStream(path), child.stdin);
  try { await Promise.all([completion, stream]); }
  catch (cause) { child.kill('SIGTERM'); throw cause; }
  finally { clearTimeout(timer); }
}
const directory = await mkdtemp(join(tmpdir(), 'counterline-restore-'));
try {
  const { accessToken: token } = await login(); const item = await dish(token, { name: 'Restore fixture', pricePaise: 14950 });
  const ingredientId = uuid();
  assert.equal((await api('/inventory/ingredients', { id: ingredientId, name: 'Restore tracked ingredient', unit: 'G', lowStockMilli: 10000 }, token)).status, 200);
  assert.equal((await api(`/inventory/ingredients/${ingredientId}/movements`, { id: uuid(), kind: 'RECEIPT', quantityMilli: 100000, reason: 'Restore delivery', expectedVersion: 0 }, token)).status, 200);
  const recipe = { itemId: item.id, kind: 'BASE', expectedVersion: 0, components: [{ ingredientId, quantityMilli: 75000 }] };
  assert.equal((await api('/inventory/recipes', recipe, token)).status, 200);
  const orderId = uuid();
  const order = await api('/orders', { id: orderId, lines: [{ itemId: item.id, quantity: 1 }] }, token);
  assert.equal(order.data.bill.totalPaise, 15698);
  assert.equal((await api(`/orders/${orderId}/cash-payment`, { receivedPaise: 15698 }, token)).status, 200);
  const tableId = uuid(); const checkId = uuid();
  assert.equal((await api('/admin/tables', { id: tableId, table: { label: 'Recovery', floor: 'Recovery drill', seats: 2 } }, token)).status, 200);
  assert.equal((await api('/checks', { id: checkId, tableId }, token)).status, 200);
  assert.equal((await api(`/checks/${checkId}/batches`, { id: uuid(), expectedVersion: 0, lines: [{ itemId: item.id, quantity: 1 }] }, token)).status, 200);
  assert.equal((await api(`/checks/${checkId}/cash-payments`, { id: uuid(), expectedVersion: 1, amountPaise: 7000 }, token)).status, 200);
  assert.equal((await api(`/checks/${checkId}/cash-payments`, { id: uuid(), expectedVersion: 2, amountPaise: 8698 }, token)).status, 200);
  assert.equal((await api('/inventory/recipes', { ...recipe, expectedVersion: 1, components: [{ ingredientId, quantityMilli: 50000 }] }, token)).status, 200);
  const countIngredientId = uuid();
  assert.equal((await api('/inventory/ingredients', { id: countIngredientId, name: 'Restore counted ingredient', unit: 'EACH', lowStockMilli: 1000 }, token)).status, 200);
  const countCommand = { id: uuid(), reason: 'Recovery physical count', lines: [{ ingredientId: countIngredientId, expectedVersion: 0, countedMilli: 12000 }] };
  const count = await api('/inventory/counts', countCommand, token); assert.equal(count.status, 200);
  const supplierId = uuid(); const purchaseIngredientId = uuid();
  assert.equal((await api('/purchasing/suppliers', { id: supplierId, name: 'Restore supplier', contact: 'Delivery desk' }, token)).status, 200);
  assert.equal((await api('/inventory/ingredients', { id: purchaseIngredientId, name: 'Restore purchased ingredient', unit: 'ML', lowStockMilli: 0 }, token)).status, 200);
  const purchaseOrder = { id: uuid(), supplierId, reference: 'Restore purchase', lines: [{ ingredientId: purchaseIngredientId, quantityMilli: 5000 }] };
  assert.equal((await api('/purchasing/orders', purchaseOrder, token)).status, 200);
  const deliveryCommand = { id: uuid(), expectedVersion: 0, reference: 'Restore partial delivery', lines: [{ ingredientId: purchaseIngredientId, expectedStockVersion: 0, quantityMilli: 2500 }] };
  const delivery = await api(`/purchasing/orders/${purchaseOrder.id}/receipts`, deliveryCommand, token); assert.equal(delivery.status, 200);
  const closeCommand = { id: uuid(), expectedVersion: 1, reason: 'Restore closed remainder' };
  assert.equal((await api(`/purchasing/orders/${purchaseOrder.id}/close`, closeCommand, token)).status, 200);
  const expected = { purchasing: { purchaseOrder, deliveryCommand, closeCommand, receipt: delivery.data,
      detail: (await api(`/purchasing/orders/${purchaseOrder.id}`, undefined, token)).data,
      history: (await api(`/inventory/movements?ingredientId=${purchaseIngredientId}`, undefined, token)).data },
    count: { command: countCommand, document: count.data,
      ingredient: (await api('/inventory', undefined, token)).data.ingredients.find(value => value.id === countIngredientId),
      history: (await api(`/inventory/movements?ingredientId=${countIngredientId}`, undefined, token)).data },
    orderId, checkId, bill: order.data.bill, report: (await api('/reports/today', undefined, token)).data,
    inventory: { ingredientId, itemId: item.id, snapshot: order.data.inventory,
      ingredient: (await api('/inventory', undefined, token)).data.ingredients.find(value => value.id === ingredientId),
      history: (await api(`/inventory/movements?ingredientId=${ingredientId}`, undefined, token)).data,
      recipe: (await api(`/inventory/recipes?itemId=${item.id}&kind=BASE&version=1`, undefined, token)).data,
    },
  };
  const record = join(directory, 'expected.json');
  await writeFile(record, JSON.stringify(expected), { mode: 0o600 });
  const dump = join(directory, 'tenant.dump');
  await transfer(['pg_dump', '-U', 'tenant_alpha', '--format=custom', 'tenant_alpha'], dump, 'dump');
  await compose(['stop', 'backend']);
  await compose(['exec', '-T', 'db', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE DATABASE restored_alpha OWNER tenant_alpha']);
  await compose(['exec', '-T', 'db', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', 'REVOKE CONNECT ON DATABASE restored_alpha FROM PUBLIC; GRANT CONNECT ON DATABASE restored_alpha TO tenant_alpha']);
  await transfer(['pg_restore', '-U', 'tenant_alpha', '--dbname=restored_alpha', '--exit-on-error', '--no-owner', '--no-privileges'], dump, 'restore');
  const registry = JSON.parse(environment.VERIFY_TENANTS_JSON);
  registry[0].jdbcUrl = 'jdbc:postgresql://db:5432/restored_alpha';
  environment.VERIFY_TENANTS_JSON = JSON.stringify(registry);
  await compose(['up', '-d', '--no-deps', '--force-recreate', '--wait', '--wait-timeout', '120', 'backend']);
  // Reload DNS without restarting the container or reallocating its ephemeral host port.
  await compose(['exec', '-T', 'web', 'nginx', '-s', 'reload']);
  await waitReady(environment.VERIFY_BASE_URL);
  assert.equal((await api('/auth/me', undefined, token)).status, 200, 'persisted session still resolves after restoring into a different database');
  await promisify(execFile)(process.execPath, ['--test', 'verification/recovery.test.mjs'], { env: { ...environment, VERIFY_RECOVERY_RECORD: record }, timeout: 60_000, maxBuffer: 1024 * 1024 }).then(result => process.stdout.write(result.stdout));
  console.log('Recovery drill passed: fresh scratch database, original receipt, cash splits, negative stock/ledger, recipe versions, submission snapshot, physical count evidence/replay, purchase order/delivery/closure, persisted session and unchanged sales.');
} finally {
  await rm(directory, { recursive: true, force: true });
}
