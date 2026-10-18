import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { api, login } from './http.mjs';

test('restored tenant retains settled bill snapshots, split payments and sales exactly', async () => {
  assert.ok(process.env.VERIFY_RECOVERY_RECORD, 'recovery case requires a completed runner-owned restore drill');
  const expected = JSON.parse(await readFile(process.env.VERIFY_RECOVERY_RECORD, 'utf8'));
  const { accessToken } = await login();
  const order = await api(`/orders/${expected.orderId}`, undefined, accessToken);
  assert.equal(order.status, 200); assert.equal(order.data.status, 'PAID');
  assert.equal(order.data.bill.totalPaise, 15698); assert.deepEqual(order.data.bill, expected.bill);
  const check = await api(`/checks/${expected.checkId}`, undefined, accessToken);
  assert.equal(check.status, 200); assert.equal(check.data.status, 'CLOSED');
  assert.equal(check.data.totalPaise, 15698); assert.equal(check.data.duePaise, 0);
  assert.deepEqual(check.data.payments.map(value => value.amountPaise), [7000, 8698]);
  const report = await api('/reports/today', undefined, accessToken);
  assert.deepEqual(report.data, expected.report);
});
