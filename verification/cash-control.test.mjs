import assert from 'node:assert/strict';
import test from 'node:test';
import { api, login, uuid, dish } from './http.mjs';
let session;
const owner = async () => (await (session ??= login())).accessToken;
test.after(async () => {
  const token = await owner(); if (!await active(token)) await open(token, 1000000);
  const beta = (await login(undefined, undefined, '/t/beta')).accessToken;
  const current = await api('/cash/active', undefined, beta, '/t/beta');
  if (!current.data.shift) assert.equal((await api('/cash/shifts', { id: uuid(), openingPaise: 1000000, reference: 'Beta regression drawer' }, beta, '/t/beta')).status, 200);
});
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const active = async token => (await api('/cash/active', undefined, token)).data.shift;
async function closeActive(token) {
  const current = await active(token); if (!current) return;
  const shift = (await api(`/cash/shifts/${current.id}`, undefined, token)).data;
  const result = await api(`/cash/shifts/${shift.id}/close`, { id: uuid(), expectedVersion: shift.version, countedPaise: Math.max(shift.expectedPaise, 0), reason: 'Verification drawer handover' }, token);
  assert.equal(result.status, 200); return result.data;
}
async function open(token, openingPaise = 10000) {
  await closeActive(token);
  const body = { id: uuid(), openingPaise, reference: 'Verification opening count' };
  const result = await api('/cash/shifts', body, token); assert.equal(result.status, 200); return result.data;
}

test('one shared drawer opens with an explicit float and closes with an immutable counted discrepancy', async () => {
  const token = await owner(); const shift = await open(token);
  assert.equal(shift.expectedPaise, 10000); assert.equal(shift.version, 0); assert.equal(shift.status, 'OPEN');
  assert.ok(shift.openedBy); assert.ok(shift.openedAt);
  const opening = { id: shift.id, openingPaise: 10000, reference: 'Verification opening count' };
  const retries = await Promise.all(Array.from({ length: 4 }, () => api('/cash/shifts', opening, token)));
  assert.ok(retries.every(value => value.status === 200)); assert.deepEqual(retries[0].data, shift);
  assert.equal((await api('/cash/shifts', { ...opening, openingPaise: 10001 }, token)).status, 409);
  assert.equal((await api('/cash/shifts', { id: uuid(), openingPaise: 20000, reference: 'Second drawer' }, token)).status, 409);
  const closing = { id: uuid(), expectedVersion: 0, countedPaise: 9900, reason: '' };
  assert.equal((await api(`/cash/shifts/${shift.id}/close`, closing, token)).status, 400);
  closing.reason = 'Counted one rupee short';
  const closed = await api(`/cash/shifts/${shift.id}/close`, closing, token);
  assert.equal(closed.status, 200); assert.equal(closed.data.discrepancyPaise, -100); assert.equal(closed.data.status, 'CLOSED');
  assert.ok(closed.data.closedBy); assert.ok(closed.data.closedAt);
  assert.deepEqual((await api(`/cash/shifts/${shift.id}/close`, closing, token)).data, closed.data);
  assert.equal((await api(`/cash/shifts/${shift.id}/close`, { ...closing, countedPaise: 10000 }, token)).status, 409);
  assert.equal(await active(token), null);
  assert.deepEqual((await api('/cash/shifts', opening, token)).data, closed.data);
  const competing = await Promise.all([1, 2].map(() => api('/cash/shifts', { id: uuid(), openingPaise: 1000, reference: 'Competing opening' }, token)));
  assert.deepEqual(competing.map(value => value.status).sort(), [200, 409]);
  await closeActive(token);
});

test('cash sale requires the observed open drawer, posts net of change once and cannot migrate on late retry', async () => {
  const token = await owner(); await closeActive(token); const item = await dish(token, { pricePaise: 10000, cgstBps: 0, sgstBps: 0 });
  const id = uuid(); assert.equal((await api('/orders', { id, lines: [{ itemId: item.id, quantity: 1 }] }, token)).status, 200);
  assert.equal((await api(`/orders/${id}/cash-payment`, { receivedPaise: 12000 }, token)).status, 409);
  assert.equal((await api(`/orders/${id}`, undefined, token)).data.status, 'OPEN');
  const shift = await open(token, 5000); const body = { receivedPaise: 12000, cashShiftId: shift.id };
  const results = await Promise.all(Array.from({ length: 4 }, () => api(`/orders/${id}/cash-payment`, body, token)));
  assert.ok(results.every(value => value.status === 200));
  assert.equal(results[0].data.cashShiftId, shift.id);
  const current = (await api(`/cash/shifts/${shift.id}`, undefined, token)).data;
  assert.equal(current.salesPaise, 10000); assert.equal(current.expectedPaise, 15000); assert.equal(current.version, 1);
  const ledger = await api(`/cash/shifts/${shift.id}/movements`, undefined, token);
  assert.equal(ledger.status, 200); assert.equal(ledger.data.movements.length, 1); assert.equal(ledger.data.movements[0].sourceId, id);
  const closed = await closeActive(token); const next = await open(token, 2000);
  assert.deepEqual((await api(`/orders/${id}/cash-payment`, body, token)).data, results[0].data);
  assert.equal((await api(`/cash/shifts/${next.id}`, undefined, token)).data.expectedPaise, 2000);
  assert.deepEqual((await api(`/cash/shifts/${shift.id}`, undefined, token)).data, closed);
  assert.equal((await api(`/orders/${id}/cash-payment`, { ...body, cashShiftId: next.id }, token)).status, 409);
});

test('operating expenses and supplier cash payments reduce the drawer once; noncash spending does not', async () => {
  const token = await owner(); const shift = await open(token, 20000);
  const expense = { id: uuid(), payee: 'Local cleaner', category: 'Cleaning', reference: 'Receipt C-1', expenseDate: today(), amountPaise: 2500, method: 'CASH', cashShiftId: shift.id };
  const spent = await api('/expenses', expense, token); assert.equal(spent.status, 200);
  assert.equal(spent.data.cashShiftId, shift.id); assert.ok(spent.data.actorId);
  assert.deepEqual((await api('/expenses', expense, token)).data, spent.data);
  const bankExpense = { ...expense, id: uuid(), reference: 'Bank receipt', method: 'BANK_TRANSFER', cashShiftId: null };
  assert.equal((await api('/expenses', bankExpense, token)).status, 200);
  const supplierId = uuid(); assert.equal((await api('/purchasing/suppliers', { id: supplierId, name: `Cash supplier ${supplierId}` }, token)).status, 200);
  const bill = { id: uuid(), supplierId, reference: 'Cash invoice', billDate: today(), dueDate: today(), totalPaise: 10000 };
  assert.equal((await api('/payables/bills', bill, token)).status, 200);
  const payment = { id: uuid(), expectedVersion: 0, amountPaise: 4000, paymentDate: today(), method: 'CASH', reference: 'Signed cash receipt', cashShiftId: shift.id };
  const paid = await api(`/payables/bills/${bill.id}/payments`, payment, token); assert.equal(paid.status, 200); assert.equal(paid.data.cashShiftId, shift.id);
  assert.deepEqual((await api(`/payables/bills/${bill.id}/payments`, payment, token)).data, paid.data);
  const current = (await api(`/cash/shifts/${shift.id}`, undefined, token)).data;
  assert.equal(current.expensesPaise, 2500); assert.equal(current.supplierPaise, 4000); assert.equal(current.expectedPaise, 13500); assert.equal(current.version, 2);
  const ledger = (await api(`/cash/shifts/${shift.id}/movements`, undefined, token)).data.movements;
  assert.deepEqual(ledger.map(value => value.kind), ['SUPPLIER_PAYMENT', 'EXPENSE']);
  assert.deepEqual(ledger.map(value => value.deltaPaise), [-4000, -2500]);
  const closed = await closeActive(token);
  assert.deepEqual((await api('/expenses', expense, token)).data, spent.data);
  assert.deepEqual((await api(`/payables/bills/${bill.id}/payments`, payment, token)).data, paid.data);
  assert.equal((await api('/expenses', { ...expense, id: uuid() }, token)).status, 409);
  assert.equal((await api('/expenses', { ...bankExpense, id: uuid() }, token)).status, 200);
  assert.deepEqual((await api(`/cash/shifts/${shift.id}`, undefined, token)).data, closed);
});

test('check splits belong to their receiving shifts and final settlement never posts kitchen batches twice', async () => {
  const token = await owner(); const shift = await open(token, 0);
  const item = await dish(token, { pricePaise: 10000, cgstBps: 0, sgstBps: 0 }); const tableId = uuid(); const id = uuid();
  assert.equal((await api('/admin/tables', { id: tableId, table: { label: `Cash ${tableId.slice(0, 8)}`, floor: 'Cash control', seats: 2 } }, token)).status, 200);
  assert.equal((await api('/checks', { id, tableId }, token)).status, 200);
  assert.equal((await api(`/checks/${id}/batches`, { id: uuid(), expectedVersion: 0, lines: [{ itemId: item.id, quantity: 1 }] }, token)).status, 200);
  const first = { id: uuid(), expectedVersion: 1, amountPaise: 4000, cashShiftId: shift.id };
  assert.equal((await api(`/checks/${id}/cash-payments`, first, token)).status, 200);
  assert.equal((await api(`/cash/shifts/${shift.id}`, undefined, token)).data.expectedPaise, 4000);
  await closeActive(token); const next = await open(token, 1000);
  assert.equal((await api(`/checks/${id}/cash-payments`, first, token)).status, 200);
  const final = { id: uuid(), expectedVersion: 2, amountPaise: 6000, cashShiftId: next.id };
  assert.equal((await api(`/checks/${id}/cash-payments`, final, token)).data.status, 'CLOSED');
  const current = (await api(`/cash/shifts/${next.id}`, undefined, token)).data;
  assert.equal(current.salesPaise, 6000); assert.equal(current.expectedPaise, 7000);
  const detail = (await api(`/checks/${id}`, undefined, token)).data;
  assert.deepEqual(detail.payments.map(value => value.cashShiftId), [shift.id, next.id]);
  const ledger = (await api(`/cash/shifts/${next.id}/movements`, undefined, token)).data.movements;
  assert.equal(ledger.length, 1); assert.equal(ledger[0].kind, 'CHECK_PAYMENT'); assert.equal(ledger[0].sourceId, final.id);
});

test('closing races serialize with receipt and expense writes; stale counts and old shift commands never rebase', async () => {
  const token = await owner(); const shift = await open(token, 10000);
  const item = await dish(token, { pricePaise: 1000, cgstBps: 0, sgstBps: 0 }); const orderId = uuid();
  assert.equal((await api('/orders', { id: orderId, lines: [{ itemId: item.id, quantity: 1 }] }, token)).status, 200);
  const closing = { id: uuid(), expectedVersion: 0, countedPaise: 10000, reason: '' };
  const results = await Promise.all([
    api(`/cash/shifts/${shift.id}/close`, closing, token),
    api(`/orders/${orderId}/cash-payment`, { receivedPaise: 1000, cashShiftId: shift.id }, token),
  ]);
  assert.deepEqual(results.map(value => value.status).sort(), [200, 409]);
  const current = (await api(`/cash/shifts/${shift.id}`, undefined, token)).data;
  assert.equal(current.salesPaise, results[1].status === 200 ? 1000 : 0);
  assert.equal((await api(`/orders/${orderId}`, undefined, token)).data.status, results[1].status === 200 ? 'PAID' : 'OPEN');
  await closeActive(token); const next = await open(token, 10000);
  const expense = { id: uuid(), payee: 'Cleaner', category: 'Cleaning', reference: 'Concurrent receipt', expenseDate: today(), amountPaise: 100, method: 'CASH', cashShiftId: next.id };
  const paid = await Promise.all(Array.from({ length: 4 }, () => api('/expenses', expense, token)));
  assert.ok(paid.every(value => value.status === 200)); assert.deepEqual(paid[0].data, paid[3].data);
  assert.equal((await api('/expenses', { ...expense, amountPaise: 101 }, token)).status, 409);
  assert.equal((await api(`/cash/shifts/${next.id}/close`, { ...closing, id: uuid() }, token)).status, 409);
  assert.equal((await api(`/cash/shifts/${next.id}`, undefined, token)).data.expectedPaise, 9900);
  const race = await Promise.all([
    api(`/cash/shifts/${next.id}/close`, { id: uuid(), expectedVersion: 1, countedPaise: 9900 }, token),
    api('/expenses', { ...expense, id: uuid() }, token),
  ]);
  assert.deepEqual(race.map(value => value.status).sort(), [200, 409]);
});

test('cash bounds, dates, supplier rollback and paginated evidence preserve the entire financial transaction', async () => {
  const token = await owner(); const shift = await open(token, 1000000000000);
  const item = await dish(token, { pricePaise: 1, cgstBps: 0, sgstBps: 0 }); const id = uuid();
  assert.equal((await api('/orders', { id, lines: [{ itemId: item.id, quantity: 1 }] }, token)).status, 200);
  assert.equal((await api(`/orders/${id}/cash-payment`, { receivedPaise: 1, cashShiftId: shift.id }, token)).status, 400);
  assert.equal((await api(`/orders/${id}`, undefined, token)).data.status, 'OPEN');
  const body = { id: uuid(), payee: 'Utility', category: 'Utilities', reference: 'Meter bill', expenseDate: today(), amountPaise: 100, method: 'CASH', cashShiftId: shift.id };
  for (const invalid of [{ amountPaise: -1 }, { amountPaise: 0 }, { amountPaise: 0.1 }, { amountPaise: 1000000000001 }, { expenseDate: '2026-02-30' }, { expenseDate: '2000-01-01' }, { method: 'UPI' }]) {
    const command = { ...body, ...invalid, id: uuid() };
    assert.equal((await api('/expenses', command, token)).status, 400);
    assert.equal((await api(`/expenses/${command.id}`, undefined, token)).status, 404);
  }
  assert.equal((await api('/expenses', { ...body, cashShiftId: null }, token)).status, 409);
  assert.equal((await api(`/cash/shifts/${shift.id}`, undefined, token)).data.version, 0);
  const vendor = uuid(); assert.equal((await api('/purchasing/suppliers', { id: vendor, name: `Atomic cash ${vendor}` }, token)).status, 200);
  const billId = uuid(); assert.equal((await api('/payables/bills', { id: billId, supplierId: vendor, reference: 'Atomic supplier', billDate: '2026-01-01', dueDate: today(), totalPaise: 1000 }, token)).status, 200);
  const payment = { id: uuid(), expectedVersion: 0, amountPaise: 100, paymentDate: today(), method: 'CASH', reference: 'Supplier receipt' };
  assert.equal((await api(`/payables/bills/${billId}/payments`, payment, token)).status, 409);
  assert.equal((await api(`/payables/bills/${billId}/payments`, { ...payment, cashShiftId: shift.id, paymentDate: '2026-01-02' }, token)).status, 400);
  assert.equal((await api(`/payables/bills/${billId}`, undefined, token)).data.bill.paidPaise, 0);
  assert.equal((await api(`/payables/bills/${billId}`, undefined, token)).data.payments.length, 0);
  assert.equal((await api('/expenses', body, token)).status, 200);
  assert.equal((await api('/expenses', { ...body, id: uuid(), amountPaise: 200 }, token)).status, 200);
  const ledger = await api(`/cash/shifts/${shift.id}/movements?limit=1`, undefined, token);
  assert.equal(ledger.data.movements.length, 1); assert.ok(ledger.data.nextCursor);
  assert.equal((await api(`/cash/shifts/${shift.id}/movements?limit=1&before=${ledger.data.nextCursor}`, undefined, token)).data.movements[0].sourceId, body.id);
  const expenses = await api('/expenses?limit=1', undefined, token); assert.equal(expenses.data.expenses.length, 1); assert.ok(expenses.data.nextCursor);
  const shifts = await api('/cash/shifts?limit=1', undefined, token); assert.equal(shifts.data.shifts[0].id, shift.id); assert.ok(shifts.data.nextCursor);
  assert.equal((await api('/cash/shifts?limit=101', undefined, token)).status, 400);
  await closeActive(token); // Avoid leaving the numeric-boundary fixture open for other suites.
  const empty = await open(token, 0);
  assert.equal((await api('/expenses', { ...body, id: uuid(), cashShiftId: empty.id }, token)).status, 200);
  const negative = (await api(`/cash/shifts/${empty.id}`, undefined, token)).data;
  assert.equal(negative.expectedPaise, -100);
  const reconciled = await closeActive(token); assert.equal(reconciled.countedPaise, 0); assert.equal(reconciled.discrepancyPaise, 100);
});

test('drawer totals and expenses are manager-only while cashier active-shift projection and tenant identities remain isolated', async () => {
  const token = await owner(); const shift = await open(token, 10000);
  const expense = { id: uuid(), payee: 'Role fixture', category: 'Cleaning', reference: 'Role receipt', expenseDate: today(), amountPaise: 100, method: 'CASH', cashShiftId: shift.id };
  for (const role of ['CASHIER', 'KITCHEN', 'MANAGER']) {
    const username = `drawer-${uuid().slice(0, 8)}`; const password = uuid();
    assert.equal((await api('/admin/staff', { id: uuid(), username, password, displayName: role, role }, token)).status, 200);
    const staff = (await login(username, password)).accessToken; const allowed = role === 'MANAGER';
    const projection = await api('/cash/active', undefined, staff); assert.equal(projection.status, role === 'KITCHEN' ? 403 : 200);
    if (role !== 'KITCHEN') assert.deepEqual(Object.keys(projection.data.shift).sort(), ['id', 'sequence']);
    for (const path of ['/cash/shifts', `/cash/shifts/${shift.id}`, `/cash/shifts/${shift.id}/movements`, '/expenses']) assert.equal((await api(path, undefined, staff)).status, allowed ? 200 : 403);
    assert.equal((await api('/expenses', expense, staff)).status, allowed ? 200 : 403);
    const close = await api(`/cash/shifts/${shift.id}/close`, { id: uuid(), expectedVersion: 1, countedPaise: 9900 }, staff); assert.equal(close.status, allowed ? 200 : 403);
    assert.equal((await api('/cash/shifts', { id: uuid(), openingPaise: 10000, reference: 'Role opening' }, staff)).status, allowed ? 200 : 403);
  }
  const beta = (await login(undefined, undefined, '/t/beta')).accessToken;
  assert.equal((await api('/cash/active', undefined, token, '/t/beta')).status, 401);
  assert.equal((await api(`/cash/shifts/${shift.id}`, undefined, beta, '/t/beta')).status, 404);
  assert.equal((await api(`/expenses/${expense.id}`, undefined, beta, '/t/beta')).status, 404);
  const created = await api('/cash/shifts', { id: shift.id, openingPaise: 20000, reference: 'Independent beta drawer' }, beta, '/t/beta'); assert.equal(created.status, 200);
  assert.equal((await api('/expenses', expense, beta, '/t/beta')).status, 200);
  assert.equal((await api(`/cash/shifts/${shift.id}`, undefined, beta, '/t/beta')).data.expectedPaise, 19900);
  assert.equal((await api(`/cash/shifts/${shift.id}`, undefined, token)).data.expectedPaise, 9900);
});
