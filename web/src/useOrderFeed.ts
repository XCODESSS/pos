import { useCallback, useEffect, useRef, useState } from 'react';
import { request, type OrderPage, type Order } from './api';

/** One bounded page, cancellation on navigation, and no overlapping background polls. */
export function useOrderFeed<T = Order>(token: string, path: string) {
  const [result, setResult] = useState<{ path: string; page: OrderPage<T>; at: string } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const current = useRef<AbortController | null>(null);
  const refresh = useCallback(async (background = false) => {
    if (background && current.current) return;
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    setLoading(true);
    try {
      const page = await request<OrderPage<T>>(token, path, undefined, controller.signal);
      if (current.current === controller && !controller.signal.aborted) {
        setResult({ path, page, at: new Date().toISOString() }); setError('');
      }
    } catch (cause) {
      if (current.current === controller && !controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : 'Could not refresh orders.');
      }
    } finally {
      if (current.current === controller) { current.current = null; setLoading(false); }
    }
  }, [token, path]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    setError('');
    async function poll() {
      if (document.visibilityState !== 'hidden') await refresh(true);
      if (active) timer = setTimeout(() => void poll(), 10_000);
    }
    void poll();
    return () => { active = false; clearTimeout(timer); current.current?.abort(); current.current = null; };
  }, [refresh]);

  return { page: result?.path === path ? result.page : null,
    updatedAt: result?.path === path ? result.at : null, error, loading, refresh };
}
