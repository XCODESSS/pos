import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { api, dish, login, uuid } from './http.mjs';

const cli = process.env.REA_CLI;
const chrome = process.env.REA_CHROME;
if (!cli || !chrome) throw new Error('Set REA_CLI to the installed rea-agents/scripts/rea.mjs and REA_CHROME to your installed Chrome executable.');
await access(cli); await access(chrome);
const directory = fileURLToPath(new URL(`./.artifacts/${process.env.VERIFY_PROJECT}/`, import.meta.url));
await mkdir(directory, { recursive: true });
const { accessToken: token } = await login();
await dish(token, { name: 'Browser coffee', category: 'Browser', pricePaise: 6000 });
const tables = [];
for (const label of ['Browser A', 'Browser B']) {
  const result = await api('/admin/tables', { id: uuid(), table: { label, floor: 'Browser floor', seats: 4 } }, token);
  assert.equal(result.status, 200); tables.push(result.data);
}
const template = JSON.parse(await readFile(new URL('./rea-frontdesk.json', import.meta.url), 'utf8'));
const substitutions = { CHROME: chrome, ORIGIN: process.env.VERIFY_BASE_URL, DESTINATION_ID: tables[1].id };
function fill(value) {
  if (typeof value === 'string') return value.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => {
    if (!(key in substitutions)) throw new Error(`Unknown scenario substitution ${key}`); return substitutions[key];
  });
  if (Array.isArray(value)) return value.map(fill);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, fill(entry)]));
  return value;
}
async function capture(name, scenario) {
  const requestFile = join(directory, `${name}-request.json`);
  const evidenceFile = join(directory, `${name}-evidence.json`);
  await writeFile(requestFile, JSON.stringify(scenario, null, 2));
  let stdout;
  try { ({ stdout } = await promisify(execFile)(process.execPath, [cli, 'capture-browser-scenario', requestFile, '--format', 'json'], { env: process.env, timeout: 180_000, maxBuffer: 20 * 1024 * 1024, windowsHide: true })); }
  catch (cause) { if (cause.stdout) await writeFile(evidenceFile, cause.stdout); throw new Error(`REA ${name} did not complete; inspect ignored evidence (credentials are declared secrets).`); }
  await writeFile(evidenceFile, stdout);
  const evidence = JSON.parse(stdout); const result = evidence.normalized_result;
  assert.ok(result, 'REA returned normalized browser evidence');
  const failed = result.steps.filter(step => step.status !== 'completed');
  if (failed.length) console.error(failed.map(step => ({ step: step.step_id, error: step.error })));
  assert.equal(failed.length, 0, `${name} declared actions completed`);
  assert.equal(result.completeness.status, 'complete');
  const pageErrors = result.events.items.filter(event => event.kind === 'page-error' || event.type === 'page-error');
  assert.equal(pageErrors.length, 0, 'no observed browser page errors');
  const last = result.steps.at(-1).artifacts;
  if (last.screenshot.state === 'captured') await writeFile(join(directory, `${name}.png`), Buffer.from(last.screenshot.value.data_base64, 'base64'));
  console.log(`REA ${name}: ${result.steps.length} completed steps; evidence ${evidence.evidence_id}; artifacts ${directory}`);
  return result;
}
const desktop = fill(template);
const desktopResult = await capture('desktop', desktop);
const journal = desktopResult.steps.at(-1).artifacts.storage.value.session_storage;
assert.ok(journal.some(entry => entry.name === 'counterline.tenant.alpha.frontdesk.selected'));
assert.ok(journal.every(entry => entry.name.startsWith('counterline.tenant.alpha.')));
const history = await api('/orders?limit=100', undefined, token);
const batch = history.data.orders.find(order => order.bill.lines.some(line => line.name.startsWith('Browser thali')));
assert.ok(batch?.checkId, 'browser created a linked kitchen batch');
const check = (await api(`/checks/${batch.checkId}`, undefined, token)).data;
assert.equal(check.status, 'CLOSED'); assert.equal(check.totalPaise, 42000); assert.equal(check.duePaise, 0);
assert.equal(check.batches.length, 2); assert.deepEqual(check.payments.map(payment => payment.amountPaise), [20000, 22000]);
assert.equal(check.table.id, tables[1].id); assert.equal(check.batches[0].kitchen.status, 'READY');

const narrow = { ...desktop,
  environment: { ...desktop.environment, viewport: { width: 390, height: 844, device_scale_factor: 1 } },
  actions: [...desktop.actions.slice(0, 3),
    { step_id: 'tables', action: 'click', locator: { kind: 'role', role: 'button', name: 'Tables & checks' } },
    { step_id: 'recover-id', action: 'fill', locator: { kind: 'css', selector: '#recover-check' }, value: { source: 'literal', value: check.id } },
    { step_id: 'recover', action: 'click', locator: { kind: 'role', role: 'button', name: 'Open check' } },
    { step_id: 'closed', action: 'wait_for', locator: { kind: 'css', selector: '.running-check .paid-message' }, state: 'visible', timeout_ms: 20000 },
    { step_id: 'receipt-summary', action: 'click', locator: { kind: 'css', selector: '.check-summary' } },
  ],
};
await capture('narrow', narrow);
const switching = { ...desktop, start_url: { url: `${process.env.VERIFY_BASE_URL}/t/beta/` },
  storage: { session_storage: [{ origin: process.env.VERIFY_BASE_URL, entries: [{ name: 'counterline.tenant.alpha.frontdesk.selected', value: { source: 'literal', value: check.id } }] }] },
  actions: [...desktop.actions.slice(0, 3),
    { step_id: 'tables', action: 'click', locator: { kind: 'role', role: 'button', name: 'Tables & checks' } },
    { step_id: 'independent-business', action: 'wait_for', locator: { kind: 'css', selector: '.workspace-notice:has-text("No tables yet.")' }, state: 'visible', timeout_ms: 20000 },
  ],
};
const betaResult = await capture('tenant-switch', switching);
assert.ok(!betaResult.steps.at(-1).artifacts.accessibility.value.text.includes(check.number), 'alpha recovery state is not displayed in beta');

const cashierPassword = uuid();
process.env.VERIFY_INVENTORY_CASHIER_PASSWORD = cashierPassword;
const createdCashier = await api('/admin/staff', { id: uuid(), username: 'inventory-browser-cashier', displayName: 'Inventory cashier', role: 'CASHIER', password: cashierPassword }, token);
assert.equal(createdCashier.status, 200);
const inventorySetup = fill(JSON.parse(await readFile(new URL('./rea-inventory-setup.json', import.meta.url), 'utf8')));
await capture('inventory-setup', inventorySetup);
const ingredient = (await api('/inventory', undefined, token)).data.ingredients.find(value => value.name === 'Browser paneer');
const inventoryDish = (await api('/admin/menu', undefined, token)).data.find(value => value.name === 'Inventory thali');
assert.ok(ingredient && inventoryDish); assert.equal(ingredient.balanceMilli, 100000);
substitutions.INGREDIENT_ID = ingredient.id; substitutions.INVENTORY_DISH = inventoryDish.id;
const inventoryScenario = fill(JSON.parse(await readFile(new URL('./rea-inventory.json', import.meta.url), 'utf8')));
const inventoryResult = await capture('inventory-workflow', inventoryScenario);
assert.ok(!inventoryResult.steps.find(step => step.step_id === 'shortage-preview').artifacts.accessibility.value.text.includes('Inventory & recipes'), 'cashier has no stock administration navigation');
const finalIngredient = (await api('/inventory', undefined, token)).data.ingredients.find(value => value.id === ingredient.id);
assert.equal(finalIngredient.balanceMilli, -50000); assert.equal(finalIngredient.lowStock, true);
const movements = (await api(`/inventory/movements?ingredientId=${ingredient.id}`, undefined, token)).data.movements;
assert.deepEqual(movements.map(value => value.deltaMilli), [-150000, 5000, -5000, 100000]);
const stockOrder = (await api('/orders?limit=100', undefined, token)).data.orders.find(value => value.bill.lines.some(line => line.itemId === inventoryDish.id));
assert.equal(stockOrder.status, 'PAID'); assert.equal(stockOrder.bill.totalPaise, 25200);
assert.equal(stockOrder.createdBy, createdCashier.data.id); assert.equal(stockOrder.paidBy, createdCashier.data.id);
assert.equal(movements.find(value => value.kind === 'CONSUMPTION').actorId, createdCashier.data.id);
assert.equal(stockOrder.inventory.warnings[0].shortageMilli, 50000); assert.equal(stockOrder.inventory.recipes[0].version, 2);
await capture('inventory-narrow', { ...inventoryScenario,
  environment: { ...inventoryScenario.environment, viewport: { width: 390, height: 844, device_scale_factor: 1 } },
  actions: [...inventoryScenario.actions.slice(0, 4),
    { step_id: 'manage-paneer', action: 'click', locator: { kind: 'role', role: 'button', name: 'Manage ingredient Browser paneer' } },
    { step_id: 'negative-visible', action: 'wait_for', locator: { kind: 'css', selector: '.stock-negative-label:has-text("-50 g")' }, state: 'visible', timeout_ms: 20000 },
    { step_id: 'negative-summary', action: 'click', locator: { kind: 'css', selector: '.stock-negative-label' } },
  ],
});
