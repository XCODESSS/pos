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
