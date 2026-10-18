import assert from 'node:assert/strict';
import test from 'node:test';
import { api, login } from './http.mjs';

test('fresh verification businesses contain no development menu or financial fixtures', async () => {
  const health = await fetch(`${process.env.VERIFY_BASE_URL}/health`).then(response => response.json());
  assert.equal(health.environment, 'verification');
  for (const path of ['/t/alpha', '/t/beta']) {
    const { accessToken } = await login(undefined, undefined, path);
    assert.deepEqual((await api('/menu', undefined, accessToken, path)).data, []);
    assert.equal((await api('/reports/today', undefined, accessToken, path)).data.totalPaise, 0);
  }
});
