import assert from 'node:assert/strict';
import test from 'node:test';
import { api, login, uuid } from './http.mjs';

let session;
const owner = async () => (await (session ??= login())).accessToken;
const indiaToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
async function billFixture(token) {
  const supplierId = uuid();
  assert.equal((await api('/purchasing/suppliers', { id: supplierId, name: `Payable supplier ${supplierId}` }, token)).status, 200);
  return { id: uuid(), supplierId, reference: `INV-${uuid()}`, billDate: '2026-01-01', dueDate: '2026-01-31', totalPaise: 10000, purchaseOrderId: null };
}

test('supplier bill records an independently entered payable without receiving stock or changing sales', async () => {
  const token = await owner(); const body = await billFixture(token);
  const stockBefore = (await api('/inventory', undefined, token)).data;
  const salesBefore = (await api('/reports/today', undefined, token)).data;
  const created = await api('/payables/bills', body, token);
  assert.equal(created.status, 200);
  assert.equal(created.data.totalPaise, 10000); assert.equal(created.data.outstandingPaise, 10000);
  assert.equal(created.data.paidPaise, 0); assert.equal(created.data.status, 'OPEN'); assert.equal(created.data.version, 0);
  assert.equal(created.data.overdue, true); assert.ok(created.data.actorId); assert.ok(created.data.createdAt);
  const detail = await api(`/payables/bills/${body.id}`, undefined, token);
  assert.equal(detail.status, 200); assert.deepEqual(detail.data.bill, created.data); assert.deepEqual(detail.data.payments, []);
  assert.deepEqual((await api('/payables/bills', body, token)).data, created.data);
  assert.deepEqual((await api('/inventory', undefined, token)).data, stockBefore);
  assert.deepEqual((await api('/reports/today', undefined, token)).data, salesBefore);
});

test('recorded partial payments reduce outstanding once and final payment settles the supplier bill', async () => {
  const token = await owner(); const body = await billFixture(token);
  assert.equal((await api('/payables/bills', body, token)).status, 200);
  const payment = { id: uuid(), expectedVersion: 0, amountPaise: 4000, paymentDate: '2026-01-02', method: 'BANK_TRANSFER', reference: 'UTR-1' };
  const first = await api(`/payables/bills/${body.id}/payments`, payment, token);
  assert.equal(first.status, 200); assert.equal(first.data.amountPaise, 4000); assert.equal(first.data.billId, body.id);
  assert.ok(first.data.actorId); assert.ok(first.data.createdAt);
  const detail = (await api(`/payables/bills/${body.id}`, undefined, token)).data;
  assert.equal(detail.bill.outstandingPaise, 6000); assert.equal(detail.bill.paidPaise, 4000); assert.equal(detail.bill.version, 1);
  assert.deepEqual(detail.payments, [first.data]);
  const final = { ...payment, id: uuid(), expectedVersion: 1, amountPaise: 6000, reference: 'UTR-2' };
  assert.equal((await api(`/payables/bills/${body.id}/payments`, final, token)).status, 200);
  assert.deepEqual((await api(`/payables/bills/${body.id}/payments`, payment, token)).data, first.data);
  const paid = (await api(`/payables/bills/${body.id}`, undefined, token)).data;
  assert.equal(paid.bill.status, 'PAID'); assert.equal(paid.bill.outstandingPaise, 0); assert.equal(paid.bill.overdue, false);
  assert.equal(paid.payments.length, 2); assert.equal(paid.bill.paidPaise, 10000); assert.equal(paid.bill.version, 2);
});

test('voiding only unpaid bills retains the reference and evidence without creating payment or stock reversal', async () => {
  const token = await owner(); const body = await billFixture(token);
  assert.equal((await api('/payables/bills', body, token)).status, 200);
  const command = { id: uuid(), expectedVersion: 0, reason: 'Entered wrong total; replacement will have a corrected reference' };
  const result = await api(`/payables/bills/${body.id}/void`, command, token);
  assert.equal(result.status, 200); assert.equal(result.data.status, 'VOID'); assert.equal(result.data.outstandingPaise, 0);
  assert.equal(result.data.totalPaise, 10000); assert.equal(result.data.paidPaise, 0); assert.equal(result.data.overdue, false);
  assert.equal(result.data.voidReason, command.reason); assert.ok(result.data.voidedBy); assert.ok(result.data.voidedAt);
  assert.deepEqual((await api(`/payables/bills/${body.id}/void`, command, token)).data, result.data);
  assert.equal((await api(`/payables/bills/${body.id}/void`, { ...command, reason: 'Changed' }, token)).status, 409);
  assert.equal((await api('/payables/bills', { ...body, id: uuid() }, token)).status, 409);
  const payment = { id: uuid(), expectedVersion: 1, amountPaise: 100, paymentDate: '2026-01-02', method: 'CASH', reference: 'Cash handed over' };
  assert.equal((await api(`/payables/bills/${body.id}/payments`, payment, token)).status, 409);
  const other = await billFixture(token); assert.equal((await api('/payables/bills', other, token)).status, 200);
  assert.equal((await api(`/payables/bills/${other.id}/payments`, { ...payment, expectedVersion: 0 }, token)).status, 200);
  assert.equal((await api(`/payables/bills/${other.id}/void`, { ...command, id: uuid(), expectedVersion: 1 }, token)).status, 409);
});

test('supplier balances include every open bill while paginated history includes paid and void evidence', async () => {
  const token = await owner(); const body = await billFixture(token);
  assert.equal((await api('/payables/bills', body, token)).status, 200);
  const dueToday = { ...body, id: uuid(), reference: 'Due today', dueDate: indiaToday(), totalPaise: 2500 };
  const todayBill = await api('/payables/bills', dueToday, token); assert.equal(todayBill.status, 200); assert.equal(todayBill.data.overdue, false);
  assert.equal((await api(`/payables/bills/${body.id}/payments`, { id: uuid(), expectedVersion: 0, amountPaise: 4000, paymentDate: '2026-01-02', method: 'UPI', reference: 'Recorded externally' }, token)).status, 200);
  const summary = await api('/payables/summary', undefined, token); assert.equal(summary.status, 200);
  assert.equal(summary.data.asOf, indiaToday()); assert.equal(summary.data.timezone, 'Asia/Kolkata');
  const balance = summary.data.suppliers.find(value => value.supplierId === body.supplierId);
  assert.equal(balance.outstandingPaise, '8500'); assert.equal(balance.overduePaise, '6000'); assert.equal(balance.openBills, '2');
  const page = await api('/payables/bills?limit=1', undefined, token); assert.equal(page.status, 200);
  assert.equal(page.data.bills[0].id, dueToday.id); assert.ok(page.data.nextCursor);
  const next = await api(`/payables/bills?limit=1&before=${page.data.nextCursor}`, undefined, token);
  assert.equal(next.data.bills[0].id, body.id);
  assert.equal((await api('/payables/bills?limit=101', undefined, token)).status, 400);
});

test('duplicate references, concurrent retries and competing payments cannot duplicate supplier liabilities or payment records', async () => {
  const token = await owner(); const body = { ...await billFixture(token), reference: '  Supplier   INV-001  ' };
  const created = await Promise.all(Array.from({ length: 4 }, () => api('/payables/bills', body, token)));
  assert.ok(created.every(value => value.status === 200)); assert.deepEqual(created[0].data, created[3].data);
  assert.equal(created[0].data.reference, 'Supplier INV-001');
  assert.equal((await api('/payables/bills', { ...body, reference: 'Supplier INV-001' }, token)).status, 200);
  assert.equal((await api('/payables/bills', { ...body, id: uuid(), reference: 'supplier inv-001' }, token)).status, 409);
  assert.equal((await api('/payables/bills', { ...body, totalPaise: 10001 }, token)).status, 409);
  const payment = { id: uuid(), expectedVersion: 0, amountPaise: 4000, paymentDate: '2026-01-02', method: 'BANK_TRANSFER', reference: '  UTR-1  ' };
  const paid = await Promise.all(Array.from({ length: 4 }, () => api(`/payables/bills/${body.id}/payments`, payment, token)));
  assert.ok(paid.every(value => value.status === 200)); assert.deepEqual(paid[0].data, paid[3].data);
  assert.equal((await api(`/payables/bills/${body.id}/payments`, { ...payment, reference: 'UTR-1' }, token)).status, 200);
  assert.equal((await api(`/payables/bills/${body.id}/payments`, { ...payment, amountPaise: 4001 }, token)).status, 409);
  assert.equal((await api(`/payables/bills/${uuid()}/payments`, payment, token)).status, 409);
  const race = await Promise.all([1, 2].map(() => api(`/payables/bills/${body.id}/payments`, { ...payment, id: uuid(), expectedVersion: 1, amountPaise: 6000 }, token)));
  assert.deepEqual(race.map(value => value.status).sort(), [200, 409]);
  const detail = (await api(`/payables/bills/${body.id}`, undefined, token)).data;
  assert.equal(detail.bill.paidPaise, 10000); assert.equal(detail.bill.version, 2); assert.equal(detail.payments.length, 2);
  const other = await billFixture(token); assert.equal((await api('/payables/bills', other, token)).status, 200);
  const competing = await Promise.all([
    api(`/payables/bills/${other.id}/payments`, { ...payment, id: uuid() }, token),
    api(`/payables/bills/${other.id}/void`, { id: uuid(), expectedVersion: 0, reason: 'Wrong invoice' }, token),
  ]);
  assert.deepEqual(competing.map(value => value.status).sort(), [200, 409]);
});

test('bill and payment validation is atomic and purchase links must match the supplier without receiving stock', async () => {
  const token = await owner(); const body = await billFixture(token);
  for (const invalid of [{ totalPaise: 0 }, { totalPaise: -1 }, { totalPaise: 1.5 }, { totalPaise: 1000000000001 },
    { billDate: '2026-02-30' }, { billDate: '2026-1-01' }, { billDate: '2099-01-01', dueDate: '2099-01-02' },
    { dueDate: '2025-12-31' }, { dueDate: '2100-01-01' }, { reference: '  ' }]) {
    const id = uuid(); assert.equal((await api('/payables/bills', { ...body, ...invalid, id }, token)).status, 400);
    assert.equal((await api(`/payables/bills/${id}`, undefined, token)).status, 404);
  }
  const ingredientId = uuid(); assert.equal((await api('/inventory/ingredients', { id: ingredientId, name: `Payable stock ${ingredientId}`, unit: 'G', lowStockMilli: 0 }, token)).status, 200);
  const orderId = uuid(); assert.equal((await api('/purchasing/orders', { id: orderId, supplierId: body.supplierId, reference: 'Quantity only', lines: [{ ingredientId, quantityMilli: 1000 }] }, token)).status, 200);
  const other = await billFixture(token);
  assert.equal((await api('/payables/bills', { ...other, purchaseOrderId: orderId }, token)).status, 400);
  const linked = await api('/payables/bills', { ...body, purchaseOrderId: orderId }, token); assert.equal(linked.status, 200); assert.equal(linked.data.purchaseOrderId, orderId);
  const payment = { id: uuid(), expectedVersion: 0, amountPaise: 4000, paymentDate: '2026-01-02', method: 'CASH', reference: 'Supplier signed receipt' };
  for (const invalid of [{ amountPaise: 10001 }, { amountPaise: 0 }, { amountPaise: -1 }, { amountPaise: 1.5 }, { amountPaise: 1000000000001 },
    { paymentDate: '2025-12-31' }, { paymentDate: '2099-01-01' }, { method: 'GATEWAY' }, { reference: '' }]) {
    assert.equal((await api(`/payables/bills/${body.id}/payments`, { ...payment, ...invalid }, token)).status, 400);
  }
  assert.equal((await api(`/payables/bills/${body.id}/payments`, { ...payment, expectedVersion: 1 }, token)).status, 409);
  const detail = (await api(`/payables/bills/${body.id}`, undefined, token)).data;
  assert.equal(detail.bill.paidPaise, 0); assert.equal(detail.bill.version, 0); assert.deepEqual(detail.payments, []);
  assert.equal((await api(`/purchasing/orders/${orderId}`, undefined, token)).data.receipts.length, 0);
  assert.equal((await api('/inventory', undefined, token)).data.ingredients.find(value => value.id === ingredientId).balanceMilli, 0);
});

test('the final supported payment slot must settle the balance rather than strand an open bill', async () => {
  const token = await owner(); const body = await billFixture(token); assert.equal((await api('/payables/bills', body, token)).status, 200);
  const payment = { amountPaise: 1, paymentDate: '2026-01-02', method: 'CASH', reference: 'Small recorded installment' };
  for (let expectedVersion = 0; expectedVersion < 99; expectedVersion++) {
    assert.equal((await api(`/payables/bills/${body.id}/payments`, { ...payment, id: uuid(), expectedVersion }, token)).status, 200);
  }
  assert.equal((await api(`/payables/bills/${body.id}/payments`, { ...payment, id: uuid(), expectedVersion: 99 }, token)).status, 400);
  assert.equal((await api(`/payables/bills/${body.id}/payments`, { ...payment, id: uuid(), expectedVersion: 99, amountPaise: 9901 }, token)).status, 200);
  const detail = (await api(`/payables/bills/${body.id}`, undefined, token)).data;
  assert.equal(detail.bill.status, 'PAID'); assert.equal(detail.bill.outstandingPaise, 0); assert.equal(detail.payments.length, 100);
});

test('supplier payables enforce explicit owner/manager permissions and isolate reused identities across businesses', async () => {
  const token = await owner(); const body = await billFixture(token); assert.equal((await api('/payables/bills', body, token)).status, 200);
  for (const role of ['CASHIER', 'KITCHEN', 'MANAGER']) {
    const username = `pay-${uuid().slice(0, 8)}`; const password = uuid();
    assert.equal((await api('/admin/staff', { id: uuid(), username, password, displayName: role, role }, token)).status, 200);
    const staff = (await login(username, password)).accessToken; const allowed = role === 'MANAGER';
    for (const path of ['/payables/summary', '/payables/bills', `/payables/bills/${body.id}`]) assert.equal((await api(path, undefined, staff)).status, allowed ? 200 : 403);
    assert.equal((await api('/payables/bills', body, staff)).status, allowed ? 200 : 403);
    assert.equal((await api(`/payables/bills/${body.id}/payments`, { id: uuid(), expectedVersion: 0, amountPaise: 100, paymentDate: '2026-01-02', method: 'OTHER', reference: 'Role record' }, staff)).status, allowed ? 200 : 403);
    const fresh = { ...body, id: uuid(), reference: `Void role ${role}` }; assert.equal((await api('/payables/bills', fresh, token)).status, 200);
    assert.equal((await api(`/payables/bills/${fresh.id}/void`, { id: uuid(), expectedVersion: 0, reason: 'Role test' }, staff)).status, allowed ? 200 : 403);
  }
  const beta = (await login(undefined, undefined, '/t/beta')).accessToken;
  assert.equal((await api('/payables/summary', undefined, token, '/t/beta')).status, 401);
  assert.equal((await api(`/payables/bills/${body.id}`, undefined, beta, '/t/beta')).status, 404);
  assert.equal((await api('/payables/bills', body, beta, '/t/beta')).status, 404);
  assert.equal((await api('/purchasing/suppliers', { id: body.supplierId, name: 'Beta payable supplier' }, beta, '/t/beta')).status, 200);
  const betaBill = await api('/payables/bills', body, beta, '/t/beta'); assert.equal(betaBill.status, 200);
  assert.equal(betaBill.data.supplierName, 'Beta payable supplier'); assert.equal(betaBill.data.paidPaise, 0);
  const payment = { id: uuid(), expectedVersion: 1, amountPaise: 500, paymentDate: '2026-01-02', method: 'CASH', reference: 'Independent payment' };
  assert.equal((await api(`/payables/bills/${body.id}/payments`, payment, token)).status, 200);
  assert.equal((await api(`/payables/bills/${body.id}/payments`, { ...payment, expectedVersion: 0 }, beta, '/t/beta')).status, 200);
  assert.equal((await api(`/payables/bills/${body.id}`, undefined, token)).data.bill.paidPaise, 600);
  assert.equal((await api(`/payables/bills/${body.id}`, undefined, beta, '/t/beta')).data.bill.paidPaise, 500);
});
