/**
 * Module-level bus so push/inbox/settings can start the tour without
 * importing React context (avoids circular deps with App.js).
 *
 * Also carries lightweight "select sub-tab" signals so tour navigation can
 * focus For You / Home hub / Live / Dating without heavy coupling.
 */

let starter = null;
let replayer = null;
const selectListeners = new Set();

export function registerTourController({ start, replay } = {}) {
  starter = typeof start === 'function' ? start : null;
  replayer = typeof replay === 'function' ? replay : null;
}

export function unregisterTourController() {
  starter = null;
  replayer = null;
}

/** Start or resume the guided tour. Safe no-op if provider not mounted. */
export function requestStartTour(opts = {}) {
  try {
    return starter?.(opts);
  } catch (e) {
    console.warn('[tour] start failed', e?.message || e);
    return undefined;
  }
}

/** Reset completion and start from step 0. */
export function requestReplayTour(opts = {}) {
  try {
    return replayer?.(opts);
  } catch (e) {
    console.warn('[tour] replay failed', e?.message || e);
    return undefined;
  }
}

/**
 * Ask a screen to select an internal sub-tab while the tour is running.
 * @param {{ screen: string, tab: string }} payload
 */
export function emitTourSelect(payload) {
  if (!payload?.screen || !payload?.tab) return;
  for (const fn of Array.from(selectListeners)) {
    try {
      fn(payload);
    } catch {
      /* ignore */
    }
  }
}

export function subscribeTourSelect(fn) {
  if (typeof fn !== 'function') return () => {};
  selectListeners.add(fn);
  return () => {
    selectListeners.delete(fn);
  };
}

export function isTourPayload(data) {
  if (!data || typeof data !== 'object') return false;
  const type = String(data.type || '').toLowerCase();
  const action = String(data.action || '').toLowerCase();
  return type === 'tour' || type === 'welcome_tour' || action === 'start_tour' || action === 'start';
}
