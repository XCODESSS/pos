import assert from 'node:assert/strict';
import test from 'node:test';
import { api, dish, login as signIn, uuid } from './http.mjs';

// These tests do not revoke the owner; reuse its session instead of consuming a sign-in per case.
const ownerSessions = new Map();
function login(username, password, tenantPath = '/t/alpha') {
  if (username !== undefined || password !== undefined) return signIn(username, password, tenantPath);
  if (!ownerSessions.has(tenantPath)) ownerSessions.set(tenantPath, signIn(undefined, undefined, tenantPath));
  return ownerSessions.get(tenantPath);
}

async function ingredient(token, balanceMilli = 500000, tenantPath) {
  const item = await api('/inventory/ingredients', { id: uuid(), name: `Count ${uuid()}`, unit: 'G', lowStockMilli: 100000 }, token, tenantPath);
  assert.equal(item.status, 200);
  if (!balanceMilli) return item.data;
  const received = await api(`/inventory/ingredients/${item.data.id}/movements`, { id: uuid(), expectedVersion: 0, kind: 'ADJUSTMENT', quantityMilli: balanceMilli, reason: 'Count fixture opening stock' }, token, tenantPath);
  assert.equal(received.status, 200); return received.data.ingredient;
}
const line = (item, countedMilli) => ({ ingredientId: item.id, expectedVersion: item.version, countedMilli });
const command = lines => ({ id: uuid(), reason: 'Closing physical count', lines });
const stock = async (token, id) => (await api('/inventory', undefined, token)).data.ingredients.find(value => value.id === id);
const history = async (token, id) => (await api(`/inventory/movements?ingredientId=${id}`, undefined, token)).data.movements;

test('physical count records a reviewed variance and a linked correction; matching counts retain evidence without zero movements', async () => {
  const { accessToken: token } = await login(); const item = await ingredient(token);
  const body = command([line(item, 450000)]);
  const response = await api('/inventory/counts', body, token);
  assert.equal(response.status, 200, 'physical count can be recorded');
  const count = response.data;
  assert.equal(count.id, body.id); assert.equal(count.reason, 'Closing physical count'); assert.ok(count.actorId); assert.ok(count.createdAt);
  assert.deepEqual(count.lines, [{ ingredientId: item.id, ingredientName: item.name, unit: 'G', observedVersion: 1, recordedMilli: 500000, countedMilli: 450000, varianceMilli: -50000 }]);
  const current = await stock(token, item.id);
  assert.equal(current.balanceMilli, 450000); assert.equal(current.version, 2);
  const movements = await history(token, item.id);
  assert.equal(movements.length, 2); assert.equal(movements[0].kind, 'COUNT'); assert.equal(movements[0].deltaMilli, -50000);
  assert.equal(movements[0].stockCountId, body.id); assert.equal(movements[0].actorId, count.actorId); assert.equal(movements[0].balanceMilli, 450000);
  assert.equal((await api(`/inventory/counts/${body.id}`, undefined, token)).status, 200);
  assert.deepEqual((await api(`/inventory/counts/${body.id}`, undefined, token)).data, count);
  const matching = await api('/inventory/counts', command([line(current, 450000)]), token);
  assert.equal(matching.status, 200); assert.equal(matching.data.lines[0].varianceMilli, 0);
  assert.equal((await history(token, item.id)).length, 2); assert.equal((await stock(token, item.id)).version, 2);
  const page = await api('/inventory/counts?limit=1', undefined, token);
  assert.equal(page.status, 200); assert.equal(page.data.counts[0].id, matching.data.id); assert.ok(page.data.nextCursor);
  const older = await api(`/inventory/counts?limit=1&before=${page.data.nextCursor}`, undefined, token);
  assert.equal(older.status, 200); assert.equal(older.data.counts[0].id, count.id);
});

test('concurrent count retries and reordered lines return immutable evidence even after subsequent stock changes', async () => {
  const { accessToken: token } = await login(); const first = await ingredient(token); const second = await ingredient(token);
  const body = command([line(first, 450000), line(second, 600000)]);
  const copies = await Promise.all(Array.from({ length: 4 }, () => api('/inventory/counts', body, token)));
  assert.ok(copies.every(value => value.status === 200));
  for (const copy of copies) assert.deepEqual(copy.data, copies[0].data);
  assert.equal((await history(token, first.id)).length, 2); assert.equal((await history(token, second.id)).length, 2);
  const current = await stock(token, first.id);
  assert.equal((await api(`/inventory/ingredients/${first.id}/movements`, { id: uuid(), expectedVersion: current.version, kind: 'RECEIPT', quantityMilli: 100000, reason: 'Later delivery' }, token)).status, 200);
  const replay = await api('/inventory/counts', { ...body, lines: [...body.lines].reverse() }, token);
  assert.equal(replay.status, 200); assert.deepEqual(replay.data, copies[0].data);
  assert.equal((await stock(token, first.id)).balanceMilli, 550000);
  assert.equal((await api('/inventory/counts', { ...body, reason: 'Different reason' }, token)).status, 409);
  assert.equal((await api('/inventory/counts', { ...body, lines: [line(first, 0), line(second, 600000)] }, token)).status, 409);
});

test('any stale count line rejects all corrections and leaves no partial count document', async () => {
  const { accessToken: token } = await login(); const first = await ingredient(token); const second = await ingredient(token);
  const body = command([line(first, 400000), line(second, 400000)]);
  assert.equal((await api(`/inventory/ingredients/${second.id}/movements`, { id: uuid(), expectedVersion: second.version, kind: 'WASTE', quantityMilli: 10000, reason: 'Waste during counting' }, token)).status, 200);
  const rejected = await api('/inventory/counts', body, token);
  assert.equal(rejected.status, 409); assert.match(rejected.data.message, /Reload and review/);
  assert.equal((await api(`/inventory/counts/${body.id}`, undefined, token)).status, 404);
  assert.equal((await stock(token, first.id)).balanceMilli, 500000); assert.equal((await history(token, first.id)).length, 1);
  assert.equal((await stock(token, second.id)).balanceMilli, 490000); assert.equal((await history(token, second.id)).length, 2);
});

test('food submission racing a stock count cannot be erased by a stale correction', async () => {
  const { accessToken: token } = await login(); const item = await ingredient(token); const food = await dish(token);
  assert.equal((await api('/inventory/recipes', { itemId: food.id, kind: 'BASE', expectedVersion: 0, components: [{ ingredientId: item.id, quantityMilli: 100000 }] }, token)).status, 200);
  const body = command([line(item, 450000)]);
  const [count, order] = await Promise.all([
    api('/inventory/counts', body, token), api('/orders', { id: uuid(), lines: [{ itemId: food.id, quantity: 1 }] }, token),
  ]);
  assert.equal(order.status, 200); assert.ok([200, 409].includes(count.status));
  assert.equal((await stock(token, item.id)).balanceMilli, count.status === 200 ? 350000 : 400000);
  const movements = await history(token, item.id);
  assert.equal(movements.filter(value => value.kind === 'CONSUMPTION').length, 1);
  assert.equal(movements.filter(value => value.kind === 'COUNT').length, count.status === 200 ? 1 : 0);
  assert.equal((await api(`/inventory/counts/${body.id}`, undefined, token)).status, count.status === 200 ? 200 : 404);
});

test('physical counts enforce exact quantities, unique lines and complete validation while allowing recovery from negative stock', async () => {
  const { accessToken: token } = await login(); const item = await ingredient(token, -1000000000000);
  const valid = command([line(item, 1000000000000)]);
  for (const invalid of [
    { ...valid, lines: [] }, { ...valid, lines: [line(item, 0), line(item, 0)] },
    { ...valid, reason: '' }, { ...valid, reason: 'bad\nreason' }, { ...valid, id: 'not-an-id' },
    ...[-1, 1.5, 1000000000001].map(quantity => ({ ...valid, lines: [line(item, quantity)] })),
    { ...valid, lines: [{ ...line(item, 0), expectedVersion: -1 }] },
  ]) assert.equal((await api('/inventory/counts', invalid, token)).status, 400);
  const missing = command([line(item, 0), { ingredientId: uuid(), expectedVersion: 0, countedMilli: 0 }]);
  assert.equal((await api('/inventory/counts', missing, token)).status, 404);
  assert.equal((await stock(token, item.id)).balanceMilli, -1000000000000);
  assert.equal((await history(token, item.id)).length, 1);
  const corrected = await api('/inventory/counts', valid, token);
  assert.equal(corrected.status, 200); assert.equal(corrected.data.lines[0].varianceMilli, 2000000000000);
  assert.equal((await stock(token, item.id)).balanceMilli, 1000000000000);
  assert.equal((await history(token, item.id))[0].deltaMilli, 2000000000000);
  const zero = await api('/inventory/counts', command([line(await stock(token, item.id), 0)]), token);
  assert.equal(zero.status, 200); assert.equal((await stock(token, item.id)).balanceMilli, 0);
  for (const suffix of ['?limit=101', '?before=0', '?limit=1&limit=2']) assert.equal((await api(`/inventory/counts${suffix}`, undefined, token)).status, 400);
});

test('count recording, lookup, history and replay respect current staff permissions and tenant isolation', async () => {
  const { accessToken: owner } = await login(); const item = await ingredient(owner);
  const body = command([line(item, 400000)]);
  assert.equal((await api('/inventory/counts', body, owner)).status, 200);
  for (const role of ['CASHIER', 'KITCHEN', 'MANAGER']) {
    const password = uuid(); const username = `count-${uuid().slice(0, 8)}`;
    assert.equal((await api('/admin/staff', { id: uuid(), username, password, displayName: role, role }, owner)).status, 200);
    const { accessToken: token } = await login(username, password); const expected = role === 'MANAGER' ? 200 : 403;
    for (const path of ['/inventory/counts', `/inventory/counts/${body.id}`]) assert.equal((await api(path, undefined, token)).status, expected);
    assert.equal((await api('/inventory/counts', body, token)).status, expected);
    const newCount = await api('/inventory/counts', command([line(await stock(owner, item.id), 350000)]), token);
    assert.equal(newCount.status, expected);
  }
  const { accessToken: beta } = await login(undefined, undefined, '/t/beta');
  assert.equal((await api('/inventory/counts', undefined, owner, '/t/beta')).status, 401);
  assert.equal((await api(`/inventory/counts/${body.id}`, undefined, beta, '/t/beta')).status, 404);
  assert.equal((await api('/inventory/counts', body, beta, '/t/beta')).status, 404);
  assert.equal((await api('/inventory/counts', undefined, beta, '/t/beta')).data.counts.length, 0);
  const betaItem = await ingredient(beta, 0, '/t/beta');
  assert.equal((await api('/inventory/counts', { ...body, lines: [line(betaItem, 1000)] }, beta, '/t/beta')).status, 200);
  assert.equal((await api(`/inventory/counts/${body.id}`, undefined, owner)).data.lines[0].countedMilli, 400000);
});
