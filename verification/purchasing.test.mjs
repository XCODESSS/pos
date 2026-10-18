import assert from 'node:assert/strict';
import test from 'node:test';
import { api, login, uuid } from './http.mjs';

let session;
const owner = async () => (await (session ??= login())).accessToken;
async function ingredient(token, name = 'Purchase flour') {
  const result = await api('/inventory/ingredients', { id: uuid(), name: `${name} ${uuid()}`, unit: 'G', lowStockMilli: 0 }, token);
  assert.equal(result.status, 200); return result.data;
}
async function supplier(token) {
  const body = { id: uuid(), name: `Supplier ${uuid()}`, contact: 'Receiving desk' };
  const result = await api('/purchasing/suppliers', body, token); assert.equal(result.status, 200, 'supplier can be created'); return result.data;
}
const stock = async (token, id) => (await api('/inventory', undefined, token)).data.ingredients.find(value => value.id === id);

test('supplier purchase order changes no stock; partial delivery records stock and remaining quantities once', async () => {
  const token = await owner(); const item = await ingredient(token); const vendor = await supplier(token);
  const body = { id: uuid(), supplierId: vendor.id, reference: 'Kitchen replenishment', lines: [{ ingredientId: item.id, quantityMilli: 1000000 }] };
  const created = await api('/purchasing/orders', body, token);
  assert.equal(created.status, 200); assert.equal(created.data.status, 'OPEN'); assert.equal(created.data.version, 0);
  assert.equal(created.data.supplierName, vendor.name); assert.equal(created.data.lines[0].orderedMilli, 1000000);
  assert.equal((await stock(token, item.id)).balanceMilli, 0);
  const receive = { id: uuid(), expectedVersion: 0, reference: 'Delivery note 1', lines: [{ ingredientId: item.id, expectedStockVersion: 0, quantityMilli: 400000 }] };
  const receipt = await api(`/purchasing/orders/${body.id}/receipts`, receive, token);
  assert.equal(receipt.status, 200); assert.equal(receipt.data.purchaseOrderId, body.id);
  assert.equal(receipt.data.lines[0].quantityMilli, 400000); assert.equal(receipt.data.lines[0].balanceMilli, 400000);
  assert.ok(receipt.data.actorId); assert.ok(receipt.data.createdAt);
  assert.equal((await stock(token, item.id)).balanceMilli, 400000);
  const detail = await api(`/purchasing/orders/${body.id}`, undefined, token);
  assert.equal(detail.status, 200); assert.equal(detail.data.order.version, 1); assert.equal(detail.data.order.status, 'OPEN');
  assert.equal(detail.data.order.lines[0].receivedMilli, 400000); assert.deepEqual(detail.data.receipts, [receipt.data]);
  const ledger = (await api(`/inventory/movements?ingredientId=${item.id}`, undefined, token)).data.movements;
  assert.equal(ledger.length, 1); assert.equal(ledger[0].kind, 'PURCHASE_RECEIPT'); assert.equal(ledger[0].purchaseReceiptId, receive.id);
  assert.equal(ledger[0].deltaMilli, 400000); assert.equal(ledger[0].actorId, receipt.data.actorId);
  const final = await api(`/purchasing/orders/${body.id}/receipts`, { ...receive, id: uuid(), expectedVersion: 1, lines: [{ ingredientId: item.id, expectedStockVersion: 1, quantityMilli: 600000 }] }, token);
  assert.equal(final.status, 200);
  assert.equal((await api(`/purchasing/orders/${body.id}`, undefined, token)).data.order.status, 'RECEIVED');
  assert.equal((await stock(token, item.id)).balanceMilli, 1000000);
});

async function purchase(token, items) {
  const vendor = await supplier(token);
  const body = { id: uuid(), supplierId: vendor.id, reference: 'Replenishment', lines: items.map(item => ({ ingredientId: item.id, quantityMilli: 1000000 })) };
  assert.equal((await api('/purchasing/orders', body, token)).status, 200); return body;
}
const delivery = (items, overrides = {}) => ({ id: uuid(), expectedVersion: 0, reference: 'Delivery note', lines: items.map(item => ({ ingredientId: item.id, expectedStockVersion: item.version, quantityMilli: 400000 })), ...overrides });

test('closing the unreceived remainder retains received stock and rejects new deliveries but allows exact recovery', async () => {
  const token = await owner(); const item = await ingredient(token); const order = await purchase(token, [item]);
  const body = delivery([item]); const received = await api(`/purchasing/orders/${order.id}/receipts`, body, token);
  assert.equal(received.status, 200);
  const close = { id: uuid(), expectedVersion: 1, reason: 'Supplier cannot deliver remainder' };
  const closed = await api(`/purchasing/orders/${order.id}/close`, close, token);
  assert.equal(closed.status, 200, 'unreceived remainder can be explicitly closed');
  assert.equal(closed.data.status, 'CLOSED'); assert.equal(closed.data.lines[0].receivedMilli, 400000);
  assert.equal(closed.data.closeReason, close.reason); assert.ok(closed.data.closedBy); assert.ok(closed.data.closedAt);
  assert.equal((await stock(token, item.id)).balanceMilli, 400000);
  assert.deepEqual((await api(`/purchasing/orders/${order.id}/close`, close, token)).data, closed.data);
  assert.equal((await api(`/purchasing/orders/${order.id}/close`, { ...close, reason: 'Other reason' }, token)).status, 409);
  const replay = await api(`/purchasing/orders/${order.id}/receipts`, body, token);
  assert.equal(replay.status, 200); assert.deepEqual(replay.data, received.data);
  assert.equal((await api(`/purchasing/orders/${order.id}/receipts`, delivery([await stock(token, item.id)], { expectedVersion: 2 }), token)).status, 409);
  assert.equal((await api('/purchasing/orders', order, token)).data.status, 'CLOSED');
});

test('supplier/order/delivery identities deduplicate concurrent retries and reject changed intent', async () => {
  const token = await owner(); const item = await ingredient(token); const second = await ingredient(token);
  const vendor = { id: uuid(), name: `Retry supplier ${uuid()}`, contact: '' };
  const suppliers = await Promise.all(Array.from({ length: 4 }, () => api('/purchasing/suppliers', vendor, token)));
  assert.ok(suppliers.every(value => value.status === 200)); assert.deepEqual(suppliers[0].data, suppliers[3].data);
  assert.equal((await api('/purchasing/suppliers', { ...vendor, contact: 'changed' }, token)).status, 409);
  assert.equal((await api('/purchasing/suppliers', { ...vendor, id: uuid(), name: vendor.name.toUpperCase() }, token)).status, 409);
  const body = { id: uuid(), supplierId: vendor.id, reference: 'Concurrent purchase', lines: [item, second].map(value => ({ ingredientId: value.id, quantityMilli: 1000000 })) };
  const orders = await Promise.all(Array.from({ length: 4 }, () => api('/purchasing/orders', body, token)));
  assert.ok(orders.every(value => value.status === 200)); assert.deepEqual(orders[0].data, orders[3].data);
  assert.equal((await api('/purchasing/orders', { ...body, lines: [...body.lines].reverse() }, token)).status, 200);
  assert.equal((await api('/purchasing/orders', { ...body, reference: 'Changed' }, token)).status, 409);
  const receive = delivery([item, second]);
  const receipts = await Promise.all(Array.from({ length: 4 }, () => api(`/purchasing/orders/${body.id}/receipts`, receive, token)));
  assert.ok(receipts.every(value => value.status === 200)); assert.deepEqual(receipts[0].data, receipts[3].data);
  assert.equal((await api(`/purchasing/orders/${body.id}/receipts`, { ...receive, lines: [...receive.lines].reverse() }, token)).status, 200);
  assert.equal((await api(`/purchasing/orders/${body.id}/receipts`, { ...receive, reference: 'Changed' }, token)).status, 409);
  assert.equal((await stock(token, item.id)).balanceMilli, 400000); assert.equal((await stock(token, second.id)).balanceMilli, 400000);
  const detail = (await api(`/purchasing/orders/${body.id}`, undefined, token)).data;
  assert.equal(detail.receipts.length, 1); assert.equal(detail.order.version, 1);
  assert.equal((await api(`/purchasing/orders/${uuid()}/receipts`, receive, token)).status, 409);
});

test('stale stock, overdelivery and numeric failures leave every stock line and the purchase document unchanged', async () => {
  const token = await owner(); const first = await ingredient(token); const second = await ingredient(token);
  const order = await purchase(token, [first, second]); const body = delivery([first, second]);
  assert.equal((await api(`/inventory/ingredients/${second.id}/movements`, { id: uuid(), expectedVersion: 0, kind: 'RECEIPT', quantityMilli: 1000, reason: 'Concurrent receiving' }, token)).status, 200);
  assert.equal((await api(`/purchasing/orders/${order.id}/receipts`, body, token)).status, 409);
  const currentSecond = await stock(token, second.id);
  const excessive = delivery([first, currentSecond]); excessive.lines[1].quantityMilli = 1000001;
  assert.equal((await api(`/purchasing/orders/${order.id}/receipts`, excessive, token)).status, 400);
  assert.equal((await stock(token, first.id)).balanceMilli, 0);
  assert.equal((await stock(token, second.id)).balanceMilli, 1000);
  const boundary = await api(`/inventory/ingredients/${second.id}/movements`, { id: uuid(), expectedVersion: currentSecond.version, kind: 'ADJUSTMENT', quantityMilli: 999999999000, reason: 'Numeric boundary' }, token);
  assert.equal(boundary.status, 200);
  assert.equal((await api(`/purchasing/orders/${order.id}/receipts`, delivery([first, boundary.data.ingredient]), token)).status, 400);
  const detail = (await api(`/purchasing/orders/${order.id}`, undefined, token)).data;
  assert.equal(detail.receipts.length, 0); assert.equal(detail.order.version, 0); assert.ok(detail.order.lines.every(value => value.receivedMilli === 0));
  assert.equal((await stock(token, first.id)).balanceMilli, 0);
  const unknown = await ingredient(token);
  assert.equal((await api(`/purchasing/orders/${order.id}/receipts`, delivery([unknown]), token)).status, 400);
  for (const quantityMilli of [0, -1, 1.5, 1000000000001]) {
    assert.equal((await api('/purchasing/orders', { ...order, id: uuid(), lines: [{ ingredientId: first.id, quantityMilli }] }, token)).status, 400);
    assert.equal((await api(`/purchasing/orders/${order.id}/receipts`, delivery([first], { lines: [{ ingredientId: first.id, quantityMilli, expectedStockVersion: 0 }] }), token)).status, 400);
  }
  assert.equal((await api('/purchasing/orders', { ...order, id: uuid(), lines: [order.lines[0], order.lines[0]] }, token)).status, 400);
});

test('competing delivery and close commands allow only one version winner without reversing stock', async () => {
  const token = await owner(); const item = await ingredient(token); const order = await purchase(token, [item]);
  const [receipt, close] = await Promise.all([
    api(`/purchasing/orders/${order.id}/receipts`, delivery([item]), token),
    api(`/purchasing/orders/${order.id}/close`, { id: uuid(), expectedVersion: 0, reason: 'Stop remaining deliveries' }, token),
  ]);
  assert.deepEqual([receipt.status, close.status].sort(), [200, 409]);
  const detail = (await api(`/purchasing/orders/${order.id}`, undefined, token)).data;
  assert.equal(detail.order.version, 1); assert.equal(detail.receipts.length, receipt.status === 200 ? 1 : 0);
  assert.equal((await stock(token, item.id)).balanceMilli, receipt.status === 200 ? 400000 : 0);
});

test('purchasing history, receiving and closing obey roles and isolate reused identities across tenants', async () => {
  const token = await owner(); const item = await ingredient(token); const order = await purchase(token, [item]);
  for (const role of ['CASHIER', 'KITCHEN', 'MANAGER']) {
    const username = `purchase-${uuid().slice(0, 8)}`; const password = uuid();
    assert.equal((await api('/admin/staff', { id: uuid(), username, password, displayName: role, role }, token)).status, 200);
    const staffToken = (await login(username, password)).accessToken; const allowed = role === 'MANAGER';
    for (const path of ['/purchasing/suppliers', '/purchasing/orders', `/purchasing/orders/${order.id}`]) assert.equal((await api(path, undefined, staffToken)).status, allowed ? 200 : 403);
    assert.equal((await api('/purchasing/suppliers', { id: uuid(), name: `Role supplier ${uuid()}` }, staffToken)).status, allowed ? 200 : 403);
    assert.equal((await api('/purchasing/orders', order, staffToken)).status, allowed ? 200 : 403);
    assert.equal((await api(`/purchasing/orders/${order.id}/receipts`, delivery([item]), staffToken)).status, allowed ? 200 : 403);
    assert.equal((await api(`/purchasing/orders/${order.id}/close`, { id: uuid(), expectedVersion: allowed ? 1 : 0, reason: 'Role close' }, staffToken)).status, allowed ? 200 : 403);
  }
  const beta = (await login(undefined, undefined, '/t/beta')).accessToken;
  assert.equal((await api('/purchasing/orders', undefined, token, '/t/beta')).status, 401);
  assert.equal((await api(`/purchasing/orders/${order.id}`, undefined, beta, '/t/beta')).status, 404);
  assert.equal((await api('/purchasing/orders', order, beta, '/t/beta')).status, 404);
  assert.equal((await api(`/purchasing/orders/${order.id}/receipts`, delivery([item]), beta, '/t/beta')).status, 404);
  assert.equal((await api('/purchasing/orders', undefined, beta, '/t/beta')).data.orders.length, 0);
  assert.equal((await api('/purchasing/suppliers', { id: order.supplierId, name: 'Independent beta supplier' }, beta, '/t/beta')).status, 200);
  assert.equal((await api('/inventory/ingredients', { id: item.id, name: 'Independent beta purchase ingredient', unit: 'ML', lowStockMilli: 0 }, beta, '/t/beta')).status, 200);
  const betaOrder = await api('/purchasing/orders', order, beta, '/t/beta');
  assert.equal(betaOrder.status, 200); assert.equal(betaOrder.data.lines[0].unit, 'ML'); assert.equal(betaOrder.data.status, 'OPEN');
  assert.equal((await api(`/purchasing/orders/${order.id}/receipts`, delivery([item]), beta, '/t/beta')).status, 200);
  assert.equal((await api(`/purchasing/orders/${order.id}`, undefined, token)).data.order.status, 'CLOSED');
  assert.equal((await stock(token, item.id)).balanceMilli, 400000);
  const page = await api('/purchasing/orders?limit=1', undefined, token);
  assert.equal(page.status, 200); assert.equal(page.data.orders[0].id, order.id); assert.ok(page.data.nextCursor);
  assert.equal((await api(`/purchasing/orders?limit=1&before=${page.data.nextCursor}`, undefined, token)).status, 200);
  assert.equal((await api('/purchasing/orders?limit=101', undefined, token)).status, 400);
});
