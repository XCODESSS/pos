import assert from 'node:assert/strict';
import test from 'node:test';
import { api, dish, login, uuid } from './http.mjs';

async function table(token, label) {
  const result = await api('/admin/tables', { id: uuid(), table: { label, floor: uuid(), seats: 4, active: true } }, token);
  assert.equal(result.status, 200); return result.data;
}
test('two batches transfer and settle once through retry-safe cash splits', async () => {
  const { accessToken: token } = await login();
  const item = await dish(token, { variants: [{ id: 'large', name: 'Large', pricePaise: 15000, available: true }], addons: [{ id: 'cheese', name: 'Cheese', pricePaise: 2000, available: true }] });
  const coffee = await dish(token, { name: 'Acceptance coffee', pricePaise: 6000 });
  const source = await table(token, 'Table A'); const destination = await table(token, 'Table B');
  const opening = { id: uuid(), tableId: source.id }; const id = opening.id;
  const before = (await api('/reports/today', undefined, token)).data;
  assert.equal((await api('/checks', opening, token)).status, 200);
  assert.equal((await api('/checks', { id: uuid(), tableId: source.id }, token)).status, 409);
  const batch = { id: uuid(), expectedVersion: 0, lines: [{ itemId: item.id, quantity: 2, variantId: 'large', addonIds: ['cheese'] }] };
  const copies = await Promise.all(Array.from({ length: 4 }, () => api(`/checks/${id}/batches`, batch, token)));
  assert.ok(copies.every(value => value.status === 200 && value.data.batches.length === 1 && value.data.version === 1));
  assert.equal(copies[0].data.totalPaise, 35700);
  assert.equal((await api(`/orders/${batch.id}/cash-payment`, { receivedPaise: 35700 }, token)).status, 409);
  assert.equal((await api(`/checks/${id}/batches`, { ...batch, id: uuid() }, token)).status, 409);
  const second = await api(`/checks/${id}/batches`, { id: uuid(), expectedVersion: 1, lines: [{ itemId: coffee.id, quantity: 1 }] }, token);
  assert.equal(second.status, 200); assert.equal(second.data.totalPaise, 42000);
  const moved = await api(`/checks/${id}/transfer`, { id: uuid(), expectedVersion: 2, tableId: destination.id }, token);
  assert.equal(moved.status, 200); assert.equal(moved.data.table.id, destination.id);
  const queue = (await api('/kitchen?limit=100', undefined, token)).data;
  assert.equal(queue.orders.find(value => value.bill.id === batch.id).bill.tableLabel, `${destination.floor} / ${destination.label}`);
  const payment = { id: uuid(), expectedVersion: 3, amountPaise: 20000 };
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await api(`/checks/${id}/cash-payments`, payment, token);
    assert.equal(result.status, 200); assert.equal(result.data.paidPaise, 20000); assert.equal(result.data.payments.length, 1);
  }
  const interim = (await api('/reports/today', undefined, token)).data;
  assert.equal(interim.totalPaise, before.totalPaise);
  assert.equal((await api(`/checks/${id}/batches`, { id: uuid(), expectedVersion: 4, lines: [{ itemId: coffee.id, quantity: 1 }] }, token)).status, 409);
  assert.equal((await api(`/checks/${id}/cash-payments`, { id: uuid(), expectedVersion: 4, amountPaise: 22001 }, token)).status, 400);
  const final = { id: uuid(), expectedVersion: 4, amountPaise: 22000 };
  const settled = await Promise.all(Array.from({ length: 4 }, () => api(`/checks/${id}/cash-payments`, final, token)));
  assert.ok(settled.every(value => value.status === 200 && value.data.status === 'CLOSED' && value.data.payments.length === 2 && value.data.duePaise === 0));
  assert.equal((await api('/checks', opening, token)).data.status, 'CLOSED');
  const after = (await api('/reports/today', undefined, token)).data;
  assert.equal(after.paidOrders - before.paidOrders, 1); assert.equal(after.totalPaise - before.totalPaise, 42000);
  const tables = (await api('/tables', undefined, token)).data;
  assert.equal(tables.find(value => value.id === destination.id).checkId, null);
});
