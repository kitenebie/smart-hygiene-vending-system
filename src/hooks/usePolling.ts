import { useEffect, useRef } from 'react';

// Schedule after completion so slow requests never pile up.
export function usePolling(load: () => Promise<void>, intervalMs = 5000) {
  const latest = useRef(load);
  useEffect(() => { latest.current = load; });
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function tick() {
      try { await latest.current(); }
      catch (error) { console.error('Dashboard refresh failed', error); }
      finally { if (!stopped) timer = setTimeout(tick, intervalMs); }
    }
    void tick();
    return () => { stopped = true; clearTimeout(timer); };
  }, [intervalMs]);
}
