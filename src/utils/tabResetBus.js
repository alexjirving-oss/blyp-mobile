// tabResetBus.js
//
// Tiny pub/sub used to implement "double-tap a bottom tab to reset it to its
// first sub-page". The Tab.Navigator detects the double tap and calls
// emitTabReset(tabName); the corresponding screen subscribes via useTabReset and
// resets its own internal sub-tab/scroll state.

import { useEffect, useRef } from 'react';

const handlers = new Map(); // tabName -> Set<fn>

export function emitTabReset(tabName) {
  const set = handlers.get(tabName);
  if (!set) return;
  for (const fn of Array.from(set)) {
    try { fn(); } catch { }
  }
}

// Subscribe to reset requests for a given tab. The latest handler is always used
// (kept in a ref) so callers can pass an inline closure without re-subscribing.
export function useTabReset(tabName, handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!tabName) return undefined;
    const fn = () => { try { ref.current?.(); } catch { } };
    let set = handlers.get(tabName);
    if (!set) {
      set = new Set();
      handlers.set(tabName, set);
    }
    set.add(fn);
    return () => {
      set.delete(fn);
      if (set.size === 0) handlers.delete(tabName);
    };
  }, [tabName]);
}
