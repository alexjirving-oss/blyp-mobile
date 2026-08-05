/**
 * Module-level bus so push/inbox/settings can start the tour without
 * importing React context (avoids circular deps with App.js).
 */

let starter = null;
let replayer = null;

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

export function isTourPayload(data) {
  if (!data || typeof data !== 'object') return false;
  const type = String(data.type || '').toLowerCase();
  const action = String(data.action || '').toLowerCase();
  return type === 'tour' || type === 'welcome_tour' || action === 'start_tour' || action === 'start';
}
