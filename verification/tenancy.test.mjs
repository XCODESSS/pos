import assert from 'node:assert/strict';
import test from 'node:test';
import { cashApi as api, login, uuid } from './http.mjs';

test('two businesses isolate sessions, identical identities, orders, checks and money', async () => {
  const alpha = '/t/alpha'; const beta = '/t/beta';
  const a = (await login(undefined, undefined, alpha)).accessToken;
  const b = (await login(undefined, undefined, beta)).accessToken;
  assert.equal((await api('/auth/me', undefined, a, beta)).status, 401);
  assert.equal((await api('/auth/me', undefined, b, alpha)).status, 401);
  const itemId = `shared-${uuid()}`;
  const item = { name: 'Tenant dish', category: 'Isolation', pricePaise: 10000, cgstBps: 0, sgstBps: 0, vegetarian: true, available: true };
  assert.equal((await api('/admin/menu', { id: itemId, item }, a, alpha)).status, 200);
  assert.equal((await api('/admin/menu', { id: itemId, item: { ...item, pricePaise: 20000 } }, b, beta)).status, 200);
  const id = uuid(); const body = { id, lines: [{ itemId, quantity: 1 }] };
  assert.equal((await api('/orders', body, a, alpha)).data.bill.totalPaise, 10000);
  assert.equal((await api(`/orders/${id}`, undefined, b, beta)).status, 404);
  assert.equal((await api('/orders', body, b, beta)).data.bill.totalPaise, 20000);
  const tableId = uuid(); const checkId = uuid();
  assert.equal((await api('/admin/tables', { id: tableId, table: { label: 'Isolated', floor: 'Main', seats: 2 } }, a, alpha)).status, 200);
  assert.equal((await api('/checks', { id: checkId, tableId }, a, alpha)).status, 200);
  assert.equal((await api(`/checks/${checkId}`, undefined, b, beta)).status, 404);
  assert.equal((await api(`/orders/${id}/cash-payment`, { receivedPaise: 10000 }, a, alpha)).status, 200);
  const betaOrder = await api(`/orders/${id}`, undefined, b, beta);
  assert.equal(betaOrder.data.status, 'OPEN');
  assert.equal((await api('/reports/today', undefined, b, beta)).data.totalPaise, 0);
  assert.equal((await api('/menu', undefined, a, '/t/unregistered')).status, 404);
  assert.equal((await api('/menu', undefined, a, '')).status, 404, 'ambiguous unscoped API is not exposed');
});
