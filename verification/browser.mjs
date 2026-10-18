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
// Separate browser identity avoids exhausting the HTTP suite's account login bucket.
const browserOwner = 'browser-owner';
process.env.VERIFY_BROWSER_OWNER_PASSWORD = uuid();
for (const tenantPath of ['/t/alpha', '/t/beta']) {
  const ownerToken = tenantPath === '/t/alpha' ? token : (await login(undefined, undefined, tenantPath)).accessToken;
  assert.equal((await api('/admin/staff', { id: uuid(), username: browserOwner, password: process.env.VERIFY_BROWSER_OWNER_PASSWORD, displayName: 'Browser owner', role: 'OWNER' }, ownerToken, tenantPath)).status, 200);
}
await dish(token, { name: 'Browser coffee', category: 'Browser', pricePaise: 6000 });
const tables = [];
for (const label of ['Browser A', 'Browser B']) {
  const result = await api('/admin/tables', { id: uuid(), table: { label, floor: 'Browser floor', seats: 4 } }, token);
  assert.equal(result.status, 200); tables.push(result.data);
}
const template = JSON.parse(await readFile(new URL('./rea-frontdesk.json', import.meta.url), 'utf8'));
const substitutions = { CHROME: chrome, ORIGIN: process.env.VERIFY_BASE_URL, DESTINATION_ID: tables[1].id, BROWSER_OWNER: browserOwner };
function fill(value) {
  if (typeof value === 'string') return value.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => {
    if (!(key in substitutions)) throw new Error(`Unknown scenario substitution ${key}`); return substitutions[key];
  });
  if (Array.isArray(value)) return value.map(fill);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, fill(entry)]));
  return value;
}
async function capture(name, scenario) {
  scenario = { ...scenario, actions: scenario.actions.map(action => action.action === 'wait_for_timeout' ? action : { timeout_ms: 10000, ...action }) };
  const requestFile = join(directory, `${name}-request.json`);
  const evidenceFile = join(directory, `${name}-evidence.json`);
  await writeFile(requestFile, JSON.stringify(scenario, null, 2));
  let stdout;
  try { ({ stdout } = await promisify(execFile)(process.execPath, [cli, 'capture-browser-scenario', requestFile, '--format', 'json'], { env: process.env, timeout: 180_000, maxBuffer: 20 * 1024 * 1024, windowsHide: true })); }
  catch (cause) {
    if (cause.stdout) await writeFile(evidenceFile, cause.stdout);
    const secrets = (scenario.secrets ?? []).map(value => process.env[value.environment_variable]).filter(Boolean);
    const stderr = secrets.reduce((text, secret) => text.replaceAll(secret, '<REDACTED>'), String(cause.stderr ?? ''));
    await writeFile(join(directory, `${name}-failure.json`), JSON.stringify({ code: cause.code, killed: cause.killed, signal: cause.signal, stderr }, null, 2));
    throw new Error(`REA ${name} did not complete (code=${cause.code}, killed=${cause.killed}, signal=${cause.signal}); inspect ignored failure/evidence artifacts.`);
  }
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

const countScenario = fill(JSON.parse(await readFile(new URL('./rea-stock-counts.json', import.meta.url), 'utf8')));
await capture('stock-count', countScenario);
const countPage = await api('/inventory/counts?limit=10', undefined, token);
const browserCount = countPage.data.counts.find(value => value.reason === 'Browser closing count');
assert.ok(browserCount); assert.equal(browserCount.lines[0].recordedMilli, -50000); assert.equal(browserCount.lines[0].countedMilli, 25000);
assert.equal(browserCount.lines[0].varianceMilli, 75000);
assert.equal((await api('/inventory', undefined, token)).data.ingredients.find(value => value.id === ingredient.id).balanceMilli, 25000);
const countedMovements = (await api(`/inventory/movements?ingredientId=${ingredient.id}`, undefined, token)).data.movements;
assert.equal(countedMovements.filter(value => value.stockCountId === browserCount.id).length, 1);
const countedOrder = await api(`/orders/${stockOrder.bill.id}`, undefined, token);
assert.equal(countedOrder.status, 200);
assert.deepEqual(countedOrder.data.inventory, stockOrder.inventory, 'count never rewrites submission evidence');

const staleScenario = { ...countScenario, actions: [
  ...countScenario.actions.slice(0, 10),
  { step_id: 'manage-before-confirm', action: 'click', locator: { kind: 'role', role: 'button', name: 'Manage ingredient Browser paneer' } },
  { step_id: 'delivery-quantity', action: 'fill', locator: { kind: 'css', selector: '#stock-quantity' }, value: { source: 'literal', value: '5' } },
  { step_id: 'delivery-reason', action: 'fill', locator: { kind: 'css', selector: '#stock-reason' }, value: { source: 'literal', value: 'Delivery during physical count' } },
  { step_id: 'delivery', action: 'click', locator: { kind: 'role', role: 'button', name: 'Record stock movement' } },
  { step_id: 'delivery-balance', action: 'wait_for', locator: { kind: 'css', selector: '.stock-balance:has-text("30 g")' }, state: 'visible', timeout_ms: 20000 },
  { step_id: 'stale-confirm', action: 'click', locator: { kind: 'role', role: 'button', name: 'Confirm stock count' } },
  { step_id: 'stale-warning', action: 'wait_for', locator: { kind: 'css', selector: '.stock-counts .error:has-text("Stock changed")' }, state: 'visible', timeout_ms: 20000 },
  { step_id: 'explicit-reload-required', action: 'wait_for', locator: { kind: 'css', selector: '.stock-counts .workspace-notice:has-text("cannot be submitted")' }, state: 'visible', timeout_ms: 20000 },
] };
await capture('stock-count-stale', staleScenario);
assert.equal((await api('/inventory', undefined, token)).data.ingredients.find(value => value.id === ingredient.id).balanceMilli, 30000);
assert.equal((await api('/inventory/counts?limit=100', undefined, token)).data.counts.filter(value => value.reason === 'Browser closing count').length, 1);

// Simulate a lost response: the committed command survives in this business's session journal.
const retryBody = { id: browserCount.id, reason: browserCount.reason, lines: browserCount.lines.map(value => ({ ingredientId: value.ingredientId, expectedVersion: value.observedVersion, countedMilli: value.countedMilli })) };
const countNarrow = { ...countScenario,
  capture: { ...countScenario.capture, at_end: [...countScenario.capture.at_end, 'storage'] },
  environment: { ...countScenario.environment, viewport: { width: 390, height: 844, device_scale_factor: 1 } },
  storage: { session_storage: [{ origin: process.env.VERIFY_BASE_URL, entries: [{ name: 'counterline.tenant.alpha.inventory.count.pending', value: { source: 'literal', value: JSON.stringify(retryBody) } }] }] },
  actions: [...countScenario.actions.slice(0, 4),
    { step_id: 'retry-retained', action: 'click', locator: { kind: 'role', role: 'button', name: 'Retry same stock count' } },
    { step_id: 'retry-confirmed', action: 'wait_for', locator: { kind: 'css', selector: '.stock-counts .success-note:has-text("recorded")' }, state: 'visible', timeout_ms: 20000 },
    { step_id: 'known-count', action: 'fill', locator: { kind: 'css', selector: '#recover-count' }, value: { source: 'literal', value: browserCount.id } },
    { step_id: 'recover', action: 'click', locator: { kind: 'role', role: 'button', name: 'Open stock count' } },
    { step_id: 'original-evidence', action: 'wait_for', locator: { kind: 'css', selector: '[aria-label="Recovered stock count"]:has-text("Recorded -50 g"):has-text("Counted 25 g")' }, state: 'visible', timeout_ms: 20000 },
    { step_id: 'evidence-summary', action: 'click', locator: { kind: 'css', selector: '[aria-label="Recovered stock count"] h4' } },
  ],
};
const recoveredCount = await capture('stock-count-narrow-recovery', countNarrow);
assert.ok(!recoveredCount.steps.at(-1).artifacts.storage.value.session_storage.some(entry => entry.name === 'counterline.tenant.alpha.inventory.count.pending'), 'confirmed replay clears the pending journal');
assert.equal((await api('/inventory', undefined, token)).data.ingredients.find(value => value.id === ingredient.id).balanceMilli, 30000, 'late replay does not overwrite the subsequent delivery');
assert.equal((await api(`/inventory/movements?ingredientId=${ingredient.id}`, undefined, token)).data.movements.filter(value => value.stockCountId === browserCount.id).length, 1);

const beforePurchasing = (await api('/inventory', undefined, token)).data.ingredients.find(value => value.id === ingredient.id);
const purchaseScenario = fill(JSON.parse(await readFile(new URL('./rea-purchasing.json', import.meta.url), 'utf8')));
await capture('purchasing', purchaseScenario);
const purchasedOrder = (await api('/purchasing/orders?limit=100', undefined, token)).data.orders.find(value => value.reference === 'Browser replenishment');
assert.ok(purchasedOrder); assert.equal(purchasedOrder.supplierName, 'Browser dairy supplier'); assert.equal(purchasedOrder.status, 'CLOSED');
assert.equal(purchasedOrder.version, 3); assert.equal(purchasedOrder.lines[0].orderedMilli, 100000); assert.equal(purchasedOrder.lines[0].receivedMilli, 60000);
const purchaseDetail = (await api(`/purchasing/orders/${purchasedOrder.id}`, undefined, token)).data;
assert.equal(purchaseDetail.receipts.length, 2); assert.deepEqual(purchaseDetail.receipts.map(value => value.lines[0].quantityMilli), [40000, 20000]);
assert.equal((await api('/inventory', undefined, token)).data.ingredients.find(value => value.id === ingredient.id).balanceMilli, 90000);
const deliveries = (await api(`/inventory/movements?ingredientId=${ingredient.id}`, undefined, token)).data.movements.filter(value => value.kind === 'PURCHASE_RECEIPT');
assert.equal(deliveries.length, 2); assert.deepEqual(deliveries.map(value => value.deltaMilli), [20000, 40000]);
assert.ok(deliveries.every(value => value.actorId === purchasedOrder.actorId));
const pendingDelivery = { kind: 'receive', path: `/purchasing/orders/${purchasedOrder.id}/receipts`, orderId: purchasedOrder.id,
  body: { id: purchaseDetail.receipts[0].id, expectedVersion: 0, reference: 'Browser delivery A', lines: [{ ingredientId: ingredient.id, expectedStockVersion: beforePurchasing.version, quantityMilli: 40000 }] },
  summary: ['Recover the original partial delivery, not a new receipt.'],
};
const recoveredPurchase = await capture('purchasing-narrow-recovery', { ...purchaseScenario,
  environment: { ...purchaseScenario.environment, viewport: { width: 390, height: 844, device_scale_factor: 1 } },
  capture: { ...purchaseScenario.capture, at_end: [...purchaseScenario.capture.at_end, 'storage'] },
  storage: { session_storage: [{ origin: process.env.VERIFY_BASE_URL, entries: [{ name: 'counterline.tenant.alpha.purchasing.pending', value: { source: 'literal', value: JSON.stringify(pendingDelivery) } }] }] },
  actions: [...purchaseScenario.actions.slice(0, 4),
    { step_id: 'retry', action: 'click', locator: { kind: 'role', role: 'button', name: 'Retry same purchase action' } },
    { step_id: 'recovered', action: 'wait_for', locator: { kind: 'css', selector: '.purchase-detail .purchase-status:has-text("CLOSED")' }, state: 'visible', timeout_ms: 20000 },
    { step_id: 'known-id', action: 'fill', locator: { kind: 'css', selector: '#recover-purchase' }, value: { source: 'literal', value: purchasedOrder.id } },
    { step_id: 'open-id', action: 'click', locator: { kind: 'role', role: 'button', name: 'Open purchase order' } },
    { step_id: 'unchanged-quantity', action: 'wait_for', locator: { kind: 'css', selector: '.purchase-detail:has-text("Received 60 g"):has-text("Closed unreceived 40 g")' }, state: 'visible', timeout_ms: 20000 },
    { step_id: 'summary', action: 'click', locator: { kind: 'css', selector: '.purchase-detail .workspace-notice' } },
  ],
});
assert.ok(!recoveredPurchase.steps.at(-1).artifacts.storage.value.session_storage.some(entry => entry.name === 'counterline.tenant.alpha.purchasing.pending'));
assert.deepEqual((await api(`/purchasing/orders/${purchasedOrder.id}`, undefined, token)).data, purchaseDetail);
const afterPurchasing = (await api('/inventory', undefined, token)).data.ingredients.find(value => value.id === ingredient.id);
assert.equal(afterPurchasing.balanceMilli, 90000);
const stalePurchaseId = uuid();
assert.equal((await api('/purchasing/orders', { id: stalePurchaseId, supplierId: purchasedOrder.supplierId, reference: 'Stale receiving fixture', lines: [{ ingredientId: ingredient.id, quantityMilli: 100000 }] }, token)).status, 200);
const staleDelivery = { ...pendingDelivery, orderId: stalePurchaseId, path: `/purchasing/orders/${stalePurchaseId}/receipts`, body: { id: uuid(), expectedVersion: 0, reference: 'Stale receiving attempt', lines: [{ ingredientId: ingredient.id, expectedStockVersion: afterPurchasing.version, quantityMilli: 10000 }] } };
assert.equal((await api(`/inventory/ingredients/${ingredient.id}/movements`, { id: uuid(), expectedVersion: afterPurchasing.version, kind: 'RECEIPT', quantityMilli: 1000, reason: 'Other delivery while purchase draft was pending' }, token)).status, 200);
await capture('purchasing-stale-recovery', { ...purchaseScenario,
  storage: { session_storage: [{ origin: process.env.VERIFY_BASE_URL, entries: [
    { name: 'counterline.tenant.alpha.purchasing.pending', value: { source: 'literal', value: JSON.stringify(staleDelivery) } },
    { name: 'counterline.tenant.alpha.purchasing.selected', value: { source: 'literal', value: stalePurchaseId } },
  ] }] },
  actions: [...purchaseScenario.actions.slice(0, 4),
    { step_id: 'retry-stale', action: 'click', locator: { kind: 'role', role: 'button', name: 'Retry same purchase action' } },
    { step_id: 'stale-rejected', action: 'wait_for', locator: { kind: 'css', selector: '.purchasing-workspace .error:has-text("Stock changed")' }, state: 'visible', timeout_ms: 20000 },
    { step_id: 'explicit-review', action: 'wait_for', locator: { kind: 'css', selector: '.purchase-detail .workspace-notice:has-text("Reload and review")' }, state: 'visible', timeout_ms: 20000 },
    { step_id: 'reload', action: 'click', locator: { kind: 'role', role: 'button', name: 'Discard delivery draft and reload' } },
    { step_id: 'no-receipt', action: 'wait_for', locator: { kind: 'css', selector: '.delivery-history:has-text("No deliveries recorded")' }, state: 'visible', timeout_ms: 20000 },
  ],
});
assert.equal((await api(`/purchasing/orders/${stalePurchaseId}`, undefined, token)).data.receipts.length, 0);
assert.equal((await api('/inventory', undefined, token)).data.ingredients.find(value => value.id === ingredient.id).balanceMilli, 91000);
