import { setTimeout as delay } from 'node:timers/promises';

/** Readiness polling is read-only. Never retry uncertain financial mutations here. */
export async function waitReady(origin) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/ready`, { signal: AbortSignal.timeout(2_000) });
      if (response.ok && (await response.json()).status === 'ready') return;
    } catch { /* The listener may not yet be bound after container startup. */ }
    await delay(250);
  }
  throw new Error('Verification web/backend readiness did not recover within 30 seconds.');
}
