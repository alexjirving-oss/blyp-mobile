/**
 * Guards for navigate-first live join status probes.
 *
 * A late `!live` must not pop the stack after the user left, opened another
 * live, or superseded the probe with a newer open.
 */

export const LIVE_STREAM_ROUTE = 'LiveStreamScreen';

/** Walk parents until the outermost navigator state is reached. */
export function getRootishNavigationState(nav) {
  if (!nav) return null;
  let current = nav;
  let state = typeof current.getState === 'function' ? current.getState() : null;
  for (;;) {
    const parent = typeof current.getParent === 'function' ? current.getParent() : null;
    if (!parent) break;
    current = parent;
    if (typeof current.getState === 'function') {
      state = current.getState();
    }
  }
  return state;
}

/**
 * LiveStreamScreen on the focused route path (deepest match wins).
 * Avoids false negatives when LiveStreamScreen hosts nested navigators.
 */
export function findFocusedLiveStreamRoute(state, routeName = LIVE_STREAM_ROUTE) {
  if (!state?.routes || typeof state.index !== 'number') return null;
  const route = state.routes[state.index];
  if (!route) return null;
  if (route.state) {
    const nested = findFocusedLiveStreamRoute(route.state, routeName);
    if (nested) return nested;
  }
  return route.name === routeName ? route : null;
}

/**
 * @returns {boolean} true when it is still safe to eject for a ended-stream probe
 */
export function shouldEjectEndedLiveProbe({
  probeGeneration,
  currentGeneration,
  expectedStreamId,
  navigationState,
  routeName = LIVE_STREAM_ROUTE,
}) {
  if (probeGeneration !== currentGeneration) return false;
  if (expectedStreamId == null || String(expectedStreamId) === '') return false;
  const liveRoute = findFocusedLiveStreamRoute(navigationState, routeName);
  if (!liveRoute) return false;
  const routeStreamId = liveRoute.params?.streamId;
  if (routeStreamId == null || String(routeStreamId) === '') return false;
  return String(routeStreamId) === String(expectedStreamId);
}

/** Pop only when generation + focused LiveStreamScreen + streamId still match. */
export function popIfEndedLiveProbe(nav, guardInput) {
  const navigationState = getRootishNavigationState(nav);
  if (!shouldEjectEndedLiveProbe({ ...guardInput, navigationState })) {
    return false;
  }
  try {
    if (typeof nav?.canGoBack === 'function' && !nav.canGoBack()) return false;
    if (typeof nav?.goBack !== 'function') return false;
    nav.goBack();
    return true;
  } catch {
    return false;
  }
}
