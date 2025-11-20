import { useEffect, useRef } from 'react';
import { waitForReady } from '../../runtime/waitForReady';

export function useSocket<T = any>(make: () => T) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await waitForReady();
      if (cancelled) return;
      ref.current = make(); // construct after runtime is ready
    })();

    return () => {
      cancelled = true;
      try {
        // Attempt to close if it looks like a WebSocket
        (ref.current as any)?.close?.();
      } catch {}
      ref.current = null;
    };
  }, [make]);

  return ref;
}
