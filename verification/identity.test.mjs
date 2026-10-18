import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { api, dish, login, uuid } from './http.mjs';

async function staff(token, role) {
  const body = { id: uuid(), username: `staff-${randomBytes(6).toString('hex')}`, displayName: role, role, password: randomBytes(24).toString('hex') };
  const result = await api('/admin/staff', body, token);
  assert.equal(result.status, 200);
  return { member: result.data, session: await login(body.username, body.password) };
}
test('kitchen staff see preparation but cannot read money or manage tables and staff', async () => {
  const { accessToken: owner } = await login(); const item = await dish(owner);
  const order = (await api('/orders', { id: uuid(), lines: [{ itemId: item.id, quantity: 1 }] }, owner)).data;
  const { session } = await staff(owner, 'KITCHEN'); const token = session.accessToken;
  for (const path of ['/tables', '/menu', '/reports/today', '/orders', '/admin/staff']) {
    assert.equal((await api(path, undefined, token)).status, 403, path);
  }
  assert.equal((await api('/admin/menu', {}, token)).status, 403);
  assert.equal((await api('/admin/tables', {}, token)).status, 403);
  const queue = await api('/kitchen', undefined, token);
  assert.equal(queue.status, 200);
  const ticket = queue.data.orders.find(value => value.bill.id === order.bill.id);
  assert.ok(ticket);
  assert.equal('totalPaise' in ticket.bill, false);
  assert.equal('unitPricePaise' in ticket.bill.lines[0], false);
  const preparing = await api(`/orders/${order.bill.id}/kitchen`, { status: 'PREPARING', expectedVersion: 0 }, token);
  assert.equal(preparing.status, 200);
  assert.equal(preparing.data.kitchen.status, 'PREPARING');
});

test('cashier cannot administer tables and a disabled account loses its issued session', async () => {
  const { accessToken: owner } = await login(); const { member, session } = await staff(owner, 'CASHIER');
  assert.equal((await api('/admin/tables', {}, session.accessToken)).status, 403);
  const result = await api(`/admin/staff/${member.id}`, { displayName: member.displayName, role: member.role, active: false, expectedVersion: member.version }, owner);
  assert.equal(result.status, 200);
  assert.equal((await api('/auth/me', undefined, session.accessToken)).status, 401);
  assert.equal((await api('/menu')).status, 401);
});
