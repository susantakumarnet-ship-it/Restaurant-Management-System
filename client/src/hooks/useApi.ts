import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

/**
 * Minimal data-fetching hook.
 *   const { data, loading, error, reload, setData } = useApi(() => adminApi.get('/tables'), [branchId]);
 * Pass `null` as fetcher to skip.
 */
export function useApi<T>(fetcher: (() => Promise<T>) | null, deps: any[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(!!fetcher);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const reload = useCallback(async () => {
    const f = fetcherRef.current;
    if (!f) return;
    const id = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const res = await f();
      if (id === seq.current) setData(res);
    } catch (e: any) {
      if (id === seq.current) setError(e?.message || 'Failed to load');
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (fetcher) reload();
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error, reload, setData };
}

/** Wrap an async action with loading state + toast on error/success. */
export function useAction<A extends any[], R>(fn: (...args: A) => Promise<R>, opts: { success?: string | ((r: R) => string); onSuccess?: (r: R) => void } = {}) {
  const [loading, setLoading] = useState(false);
  const run = useCallback(
    async (...args: A): Promise<R | undefined> => {
      setLoading(true);
      try {
        const r = await fn(...args);
        if (opts.success) toast.success(typeof opts.success === 'function' ? opts.success(r) : opts.success);
        opts.onSuccess?.(r);
        return r;
      } catch (e: any) {
        toast.error(e?.message || 'Something went wrong');
        return undefined;
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fn]
  );
  return { run, loading };
}

/** Re-run a callback on an interval while the tab is visible (for live boards). */
export function usePolling(cb: () => void, ms: number, enabled = true) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') ref.current();
    }, ms);
    return () => clearInterval(id);
  }, [ms, enabled]);
}
