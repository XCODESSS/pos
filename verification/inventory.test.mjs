import assert from 'node:assert/strict';
import test from 'node:test';
import { api, dish, login, uuid } from './http.mjs';

async function ingredient(token, name = 'Paneer', unit = 'G', tenantPath) {
  const response = await api('/inventory/ingredients', { id: uuid(), name: `${name} ${uuid().slice(0, 8)}`, unit, lowStockMilli: 100000 }, token, tenantPath);
  assert.equal(response.status, 200, 'ingredient creation succeeds'); return response.data;
}
async function balance(token, id, tenantPath) {
  const response = await api('/inventory', undefined, token, tenantPath); assert.equal(response.status, 200);
  return response.data.ingredients.find(value => value.id === id);
}
async function move(token, item, quantityMilli, kind = 'RECEIPT', overrides = {}) {
  return api(`/inventory/ingredients/${item.id}/movements`, { id: uuid(), kind, quantityMilli, reason: 'Acceptance stock', reference: 'Delivery 1', expectedVersion: item.version, ...overrides }, token);
}

test('ingredient receives 500 grams with an attributable immutable movement', async () => {
  const { accessToken: token } = await login(); const item = await ingredient(token);
  assert.equal(item.balanceMilli, 0); assert.equal(item.unit, 'G');
  const receipt = await move(token, item, 500000);
  assert.equal(receipt.status, 200); assert.equal(receipt.data.ingredient.balanceMilli, 500000);
  assert.equal(receipt.data.movement.deltaMilli, 500000); assert.equal(receipt.data.movement.kind, 'RECEIPT');
  const history = await api(`/inventory/movements?ingredientId=${item.id}`, undefined, token);
  assert.equal(history.status, 200); assert.equal(history.data.movements.length, 1);
  assert.equal(history.data.movements[0].balanceMilli, 500000);
  assert.ok(history.data.movements[0].actorId);
});

test('manual stock retries deduplicate, stale deltas reject and waste can expose negative stock', async () => {
  const { accessToken: token } = await login(); const item = await ingredient(token);
  const id = uuid();
  const repeated = await Promise.all(Array.from({ length: 4 }, () => move(token, item, 500000, 'RECEIPT', { id })));
  assert.ok(repeated.every(result => result.status === 200 && result.data.ingredient.balanceMilli === 500000));
  assert.equal(new Set(repeated.map(result => result.data.movement.sequence)).size, 1);
  assert.equal((await move(token, item, 600000, 'RECEIPT', { id })).status, 409);
  assert.equal((await move(token, item, -500, 'ADJUSTMENT')).status, 409);
  let current = await balance(token, item.id);
  const wasted = await move(token, current, 600000, 'WASTE');
  assert.equal(wasted.status, 200); assert.equal(wasted.data.ingredient.balanceMilli, -100000); assert.equal(wasted.data.ingredient.lowStock, true);
  current = wasted.data.ingredient;
  const corrected = await move(token, current, 150000, 'ADJUSTMENT', { reason: 'Physical count correction' });
  assert.equal(corrected.status, 200); assert.equal(corrected.data.ingredient.balanceMilli, 50000);
  const history = (await api(`/inventory/movements?ingredientId=${item.id}&limit=2`, undefined, token)).data;
  assert.deepEqual(history.movements.map(value => value.deltaMilli), [150000, -600000]); assert.ok(history.nextCursor);
  const older = (await api(`/inventory/movements?ingredientId=${item.id}&before=${history.nextCursor}`, undefined, token)).data;
  assert.deepEqual(older.movements.map(value => value.deltaMilli), [500000]);
});

test('versioned recipe preview warns about a shortage without reserving or deducting stock', async () => {
  const { accessToken: token } = await login(); const item = await ingredient(token); const food = await dish(token);
  assert.equal((await move(token, item, 500000)).status, 200);
  const recipe = await api('/inventory/recipes', { itemId: food.id, kind: 'BASE', choiceId: null, expectedVersion: 0, components: [{ ingredientId: item.id, quantityMilli: 150000 }] }, token);
  assert.equal(recipe.status, 200); assert.equal(recipe.data.version, 1);
  const preview = await api('/orders/stock-preview', { lines: [{ itemId: food.id, quantity: 4 }] }, token);
  assert.equal(preview.status, 200);
  assert.equal(preview.data.requirements[0].quantityMilli, 600000);
  assert.equal(preview.data.warnings[0].availableMilli, 500000);
  assert.equal(preview.data.warnings[0].shortageMilli, 100000);
  assert.equal((await balance(token, item.id)).balanceMilli, 500000);
  assert.equal((await api(`/inventory/movements?ingredientId=${item.id}`, undefined, token)).data.movements.length, 1);
});

test('accepted submission consumes once despite shortage and concurrent replay; later recipes never rewrite it', async () => {
  const { accessToken: token } = await login(); const item = await ingredient(token); const food = await dish(token);
  await move(token, item, 500000);
  const mapping = { itemId: food.id, kind: 'BASE', choiceId: null, expectedVersion: 0, components: [{ ingredientId: item.id, quantityMilli: 150000 }] };
  assert.equal((await api('/inventory/recipes', mapping, token)).status, 200);
  const body = { id: uuid(), lines: [{ itemId: food.id, quantity: 4 }] };
  const copies = await Promise.all(Array.from({ length: 4 }, () => api('/orders', body, token)));
  assert.ok(copies.every(value => value.status === 200));
  const snapshot = copies[0].data.inventory;
  assert.ok(snapshot, 'accepted order records stock evidence');
  assert.equal(snapshot.warnings[0].shortageMilli, 100000);
  assert.equal(snapshot.recipes[0].version, 1);
  assert.equal((await balance(token, item.id)).balanceMilli, -100000);
  const history = (await api(`/inventory/movements?ingredientId=${item.id}`, undefined, token)).data.movements;
  assert.equal(history.filter(value => value.orderId === body.id).length, 1);
  assert.equal(history.find(value => value.orderId === body.id).deltaMilli, -600000);
  const revised = await api('/inventory/recipes', { ...mapping, expectedVersion: 1, components: [{ ingredientId: item.id, quantityMilli: 100000 }] }, token);
  assert.equal(revised.status, 200); assert.equal(revised.data.version, 2);
  assert.equal((await api('/inventory/recipes', { ...mapping, components: [{ ingredientId: item.id, quantityMilli: 200000 }] }, token)).status, 409);
  assert.deepEqual((await api('/orders', body, token)).data.inventory, snapshot);
  assert.equal((await balance(token, item.id)).balanceMilli, -100000);
  const next = await api('/orders', { id: uuid(), lines: [{ itemId: food.id, quantity: 1 }] }, token);
  assert.equal(next.data.inventory.recipes[0].version, 2); assert.equal((await balance(token, item.id)).balanceMilli, -200000);
  assert.equal((await api(`/inventory/recipes?itemId=${food.id}&kind=BASE&version=1`, undefined, token)).data.components[0].quantityMilli, 150000);
});

test('variant replaces base, add-ons add per serving and check batches consume independently of payment or preparation', async () => {
  const { accessToken: token } = await login(); const paneer = await ingredient(token); const oil = await ingredient(token, 'Oil', 'ML');
  await move(token, paneer, 1000000); await move(token, oil, 100000);
  const food = await dish(token, { variants: [{ id: 'large', name: 'Large', pricePaise: 15000, available: true }], addons: [{ id: 'cheese', name: 'Cheese', pricePaise: 2000, available: true }] });
  for (const [kind, choiceId, components] of [
    ['BASE', null, [{ ingredientId: paneer.id, quantityMilli: 100000 }]],
    ['VARIANT', 'large', [{ ingredientId: paneer.id, quantityMilli: 150000 }, { ingredientId: oil.id, quantityMilli: 10000 }]],
    ['ADDON', 'cheese', [{ ingredientId: paneer.id, quantityMilli: 25000 }]],
  ]) assert.equal((await api('/inventory/recipes', { itemId: food.id, kind, choiceId, components, expectedVersion: 0 }, token)).status, 200);
  const line = { itemId: food.id, quantity: 2, variantId: 'large', addonIds: ['cheese'] };
  const takeaway = await api('/orders', { id: uuid(), lines: [line] }, token);
  assert.equal(takeaway.status, 200); assert.equal(takeaway.data.inventory.missingRecipes.length, 0);
  assert.equal((await balance(token, paneer.id)).balanceMilli, 650000); assert.equal((await balance(token, oil.id)).balanceMilli, 80000);
  const tableId = uuid(); const checkId = uuid();
  assert.equal((await api('/admin/tables', { id: tableId, table: { label: 'Stock check', floor: uuid(), seats: 2 } }, token)).status, 200);
  await api('/checks', { id: checkId, tableId }, token);
  const body = { id: uuid(), expectedVersion: 0, lines: [{ ...line, quantity: 1 }] };
  const copies = await Promise.all(Array.from({ length: 4 }, () => api(`/checks/${checkId}/batches`, body, token)));
  assert.ok(copies.every(value => value.status === 200 && value.data.batches.length === 1));
  assert.equal((await balance(token, paneer.id)).balanceMilli, 475000);
  assert.equal((await api(`/checks/${checkId}/batches`, { ...body, id: uuid(), expectedVersion: 1 }, token)).status, 200);
  assert.equal((await balance(token, paneer.id)).balanceMilli, 300000);
  assert.equal((await api(`/orders/${body.id}/kitchen`, { status: 'PREPARING', expectedVersion: 0 }, token)).status, 200);
  assert.equal((await api(`/checks/${checkId}/cash-payments`, { id: uuid(), expectedVersion: 2, amountPaise: 35700 }, token)).status, 200);
  assert.equal((await balance(token, paneer.id)).balanceMilli, 300000); assert.equal((await balance(token, oil.id)).balanceMilli, 60000);
  const ledger = (await api(`/inventory/movements?ingredientId=${paneer.id}`, undefined, token)).data.movements;
  assert.deepEqual(ledger.filter(value => value.kind === 'CONSUMPTION').map(value => value.deltaMilli), [-175000, -175000, -350000]);
});

test('unmapped submissions warn and never acquire a retroactive deduction when coverage is added', async () => {
  const { accessToken: token } = await login(); const item = await ingredient(token); const food = await dish(token);
  const body = { id: uuid(), lines: [{ itemId: food.id, quantity: 1 }] };
  const original = await api('/orders', body, token);
  assert.equal(original.status, 200); assert.equal(original.data.inventory.missingRecipes.length, 1);
  await api('/inventory/recipes', { itemId: food.id, kind: 'BASE', expectedVersion: 0, components: [{ ingredientId: item.id, quantityMilli: 125 }] }, token);
  assert.deepEqual((await api('/orders', body, token)).data.inventory, original.data.inventory);
  assert.equal((await balance(token, item.id)).balanceMilli, 0);
  const bad = { itemId: food.id, kind: 'BASE', expectedVersion: 1, components: [{ ingredientId: item.id, quantityMilli: 125 }, { ingredientId: item.id, quantityMilli: 125 }] };
  assert.equal((await api('/inventory/recipes', bad, token)).status, 400);
  assert.equal((await move(token, item, 0)).status, 400);
  assert.equal((await move(token, item, 1.5)).status, 400);
  assert.equal((await move(token, item, -100, 'RECEIPT')).status, 400);
  assert.equal((await move(token, item, 100, 'RECEIPT', { reason: '' })).status, 400);
  assert.equal((await api(`/inventory/ingredients/${item.id}`, { expectedVersion: 0, name: item.name, lowStockMilli: 0, unit: 'ML' }, token)).status, 400);
  const next = await api('/orders', { ...body, id: uuid() }, token);
  assert.equal(next.status, 200); assert.equal((await balance(token, item.id)).balanceMilli, -125);
});

test('stock administration is role-guarded while cashier shortage previews remain available', async () => {
  const { accessToken: owner } = await login(); const food = await dish(owner);
  for (const role of ['CASHIER', 'KITCHEN', 'MANAGER']) {
    const password = uuid(); const username = `stock-${uuid().slice(0, 8)}`;
    assert.equal((await api('/admin/staff', { id: uuid(), username, password, displayName: role, role }, owner)).status, 200);
    const { accessToken: token } = await login(username, password);
    const permitted = role === 'MANAGER';
    assert.equal((await api('/inventory', undefined, token)).status, permitted ? 200 : 403);
    assert.equal((await api('/inventory/ingredients', { id: uuid(), name: `Role ${uuid()}`, unit: 'EACH', lowStockMilli: 0 }, token)).status, permitted ? 200 : 403);
    const preview = await api('/orders/stock-preview', { lines: [{ itemId: food.id, quantity: 1 }] }, token);
    assert.equal(preview.status, role === 'KITCHEN' ? 403 : 200);
  }
});

test('ingredients, recipes and stock ledgers remain isolated between independent businesses', async () => {
  const { accessToken: alpha } = await login(); const { accessToken: beta } = await login(undefined, undefined, '/t/beta');
  const item = await ingredient(alpha);
  assert.equal((await api(`/inventory/movements?ingredientId=${item.id}`, undefined, beta, '/t/beta')).status, 404);
  assert.equal((await api(`/inventory/ingredients/${item.id}/movements`, { id: uuid(), expectedVersion: 0, kind: 'RECEIPT', quantityMilli: 1000, reason: 'Foreign receipt' }, beta, '/t/beta')).status, 404);
  assert.equal((await api('/inventory', undefined, alpha, '/t/beta')).status, 401);
  const food = { name: 'Beta stock dish', category: 'Beta', pricePaise: 1000, cgstBps: 0, sgstBps: 0, available: true, vegetarian: true };
  const foodId = `beta-${uuid()}`;
  await api('/admin/menu', { id: foodId, item: food }, beta, '/t/beta');
  assert.equal((await api('/inventory/recipes', { itemId: foodId, kind: 'BASE', expectedVersion: 0, components: [{ ingredientId: item.id, quantityMilli: 1000 }] }, beta, '/t/beta')).status, 404);
  assert.equal((await api('/inventory/ingredients', { id: item.id, name: 'Beta independent ingredient', unit: 'ML', lowStockMilli: 0 }, beta, '/t/beta')).status, 200);
  assert.equal((await balance(alpha, item.id)).unit, 'G'); assert.equal((await balance(beta, item.id, '/t/beta')).unit, 'ML');
});
