import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const origin = process.env.VERIFY_BASE_URL;
if (process.env.COUNTERLINE_VERIFICATION !== 'isolated' || !origin || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) {
  throw new Error('Run via node verification/run.mjs; mutation tests require its isolated loopback stack.');
}
export async function api(path, body, token, tenantPath = process.env.VERIFY_TENANT_PATH ?? '') {
  const response = await fetch(`${origin}${tenantPath}/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = { message: 'Non-JSON response' }; }
  return { status: response.status, data };
}
export async function login(username = process.env.VERIFY_OWNER_USERNAME, password = process.env.VERIFY_OWNER_PASSWORD, tenantPath) {
  const result = await api('/auth/login', { username, password }, undefined, tenantPath);
  assert.equal(result.status, 200, 'fixture staff sign-in succeeds');
  return result.data;
}
export async function dish(token, overrides = {}, id = `dish-${randomUUID()}`) {
  const item = { name: 'Acceptance dosa', category: 'Acceptance', pricePaise: 14000, cgstBps: 250, sgstBps: 250, vegetarian: true, available: true, variants: [], addons: [], ...overrides };
  const response = await api('/admin/menu', { id, item }, token);
  assert.equal(response.status, 200, 'fixture dish creation succeeds');
  return response.data;
}
export const uuid = randomUUID;
