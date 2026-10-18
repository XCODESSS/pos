import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { api, dish, login, uuid } from './http.mjs';

assert.match(process.env.VERIFY_PROJECT ?? '', /^counterline-verify-[a-f0-9]{12}$/);
const directory = new URL(`./.artifacts/${process.env.VERIFY_PROJECT}/`, import.meta.url);
const record = new URL('upgrade.json', directory);
const { accessToken: token } = await login();
if (process.argv[2] === 'before') {
  const item = await dish(token, { name: 'V5 upgrade receipt' });
  const body = { id: uuid(), lines: [{ itemId: item.id, quantity: 1 }] };
  const result = await api('/orders', body, token); assert.equal(result.status, 200); assert.equal(result.data.bill.totalPaise, 14700);
  assert.equal((await api(`/orders/${body.id}/cash-payment`, { receivedPaise: 14700 }, token)).status, 200);
  await mkdir(directory, { recursive: true }); await writeFile(record, JSON.stringify({ body, bill: result.data.bill, itemId: item.id }, null, 2));
  console.log('Upgrade fixture: legacy image created a persisted paid INR 147 bill.');
} else if (process.argv[2] === 'after') {
  const expected = JSON.parse(await readFile(record, 'utf8'));
  const order = await api(`/orders/${expected.body.id}`, undefined, token);
  assert.equal(order.status, 200); assert.deepEqual(order.data.bill, expected.bill); assert.equal(order.data.status, 'PAID'); assert.equal(order.data.inventory, null);
  assert.deepEqual((await api('/inventory', undefined, token)).data.ingredients, []);
  const id = uuid();
  assert.equal((await api('/inventory/ingredients', { id, name: 'Upgrade ingredient', unit: 'G', lowStockMilli: 0 }, token)).status, 200);
  assert.equal((await api(`/inventory/ingredients/${id}/movements`, { id: uuid(), expectedVersion: 0, kind: 'RECEIPT', quantityMilli: 100000, reason: 'After upgrade' }, token)).status, 200);
  assert.equal((await api('/inventory/recipes', { itemId: expected.itemId, kind: 'BASE', expectedVersion: 0, components: [{ ingredientId: id, quantityMilli: 75000 }] }, token)).status, 200);
  const replay = await api('/orders', expected.body, token); assert.equal(replay.status, 200); assert.equal(replay.data.inventory, null);
  assert.equal((await api('/inventory', undefined, token)).data.ingredients.find(value => value.id === id).balanceMilli, 100000);
  assert.equal((await api(`/inventory/movements?ingredientId=${id}`, undefined, token)).data.movements.length, 1);
  console.log('Upgrade gate passed: legacy receipt/payment unchanged, stock history remains unknown, and replay does not retro-deduct newly mapped recipes.');
} else throw new Error('Use before/after phases from the verification runner.');
