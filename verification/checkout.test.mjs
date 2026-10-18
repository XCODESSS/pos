import assert from 'node:assert/strict';
import test from 'node:test';
import { api, dish, login, uuid } from './http.mjs';

test('server prices two INR 140 dishes with independently rounded split GST', async () => {
  const owner = await login(); const item = await dish(owner.accessToken);
  const { status, data: order } = await api('/orders', { id: uuid(), lines: [{ itemId: item.id, quantity: 2 }] }, owner.accessToken);
  assert.equal(status, 200);
  assert.equal(order.bill.subtotalPaise, 28000);
  assert.equal(order.bill.cgstPaise, 700);
  assert.equal(order.bill.sgstPaise, 700);
  assert.equal(order.bill.totalPaise, 29400);
});

test('concurrent order and cash retries create one paid sale, while changed intent conflicts', async () => {
  const owner = await login(); const token = owner.accessToken; const item = await dish(token);
  const before = (await api('/reports/today', undefined, token)).data;
  const body = { id: uuid(), lines: [{ itemId: item.id, quantity: 2 }] };
  const created = await Promise.all(Array.from({ length: 4 }, () => api('/orders', body, token)));
  assert.ok(created.every(value => value.status === 200));
  assert.equal(new Set(created.map(value => value.data.bill.billNumber)).size, 1);
  assert.equal((await api('/orders', { ...body, lines: [{ itemId: item.id, quantity: 1 }] }, token)).status, 409);
  assert.equal((await api('/orders', { id: uuid(), lines: [{ itemId: item.id, quantity: 0 }] }, token)).status, 400);
  assert.equal((await api(`/orders/${body.id}/cash-payment`, { receivedPaise: 29399 }, token)).status, 400);
  const paid = await Promise.all(Array.from({ length: 4 }, () => api(`/orders/${body.id}/cash-payment`, { receivedPaise: 29400 }, token)));
  assert.ok(paid.every(value => value.status === 200 && value.data.status === 'PAID'));
  assert.equal((await api(`/orders/${body.id}/cash-payment`, { receivedPaise: 30000 }, token)).status, 409);
  const after = (await api('/reports/today', undefined, token)).data;
  assert.equal(after.paidOrders - before.paidOrders, 1);
  assert.equal(after.totalPaise - before.totalPaise, 29400);
});

test('menu edits affect future orders, never historical bill snapshots or replay intent', async () => {
  const { accessToken: token } = await login(); const item = await dish(token);
  const body = { id: uuid(), lines: [{ itemId: item.id, quantity: 1 }] };
  const original = (await api('/orders', body, token)).data.bill;
  const changed = { ...item, name: 'New name', pricePaise: 20000 };
  const { id, version, ...write } = changed;
  assert.equal((await api(`/admin/menu/${id}`, { expectedVersion: version, item: write }, token)).status, 200);
  assert.equal((await api(`/admin/menu/${id}`, { expectedVersion: version, item: { ...write, pricePaise: 21000 } }, token)).status, 409);
  const old = await api(`/orders/${body.id}`, undefined, token);
  assert.deepEqual(old.data.bill, original);
  const replay = await api('/orders', { ...body, lines: [{ ...body.lines[0], variantId: null, addonIds: [] }] }, token);
  assert.equal(replay.status, 200); assert.deepEqual(replay.data.bill, original);
  const future = await api('/orders', { ...body, id: uuid() }, token);
  assert.equal(future.data.bill.totalPaise, 21000);
});
