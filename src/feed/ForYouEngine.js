/**
 * For You engine — load window and slot roles for the 3-player shorts pool.
 * active ± 1 neighbors only (Fold decode budget).
 */

export const FOR_YOU_POOL_SIZE = 3;
export const FOR_YOU_WARM_RADIUS = 1;

/**
 * @param {number} index
 * @param {number} activeIndex
 * @returns {'active'|'neighbor'|'none'}
 */
export function roleForIndex(index, activeIndex) {
  const i = Number(index);
  const a = Number(activeIndex);
  if (!Number.isFinite(i) || !Number.isFinite(a)) return 'none';
  const dist = Math.abs(i - a);
  if (dist === 0) return 'active';
  if (dist <= FOR_YOU_WARM_RADIUS) return 'neighbor';
  return 'none';
}

/**
 * @param {number} index
 * @param {number} activeIndex
 * @param {number} [loadIndex] mid-swipe decode center (may lead active)
 */
export function shouldLoadCell(index, activeIndex, loadIndex = activeIndex) {
  const i = Number(index);
  const a = Number(activeIndex);
  const l = Number.isFinite(Number(loadIndex)) ? Number(loadIndex) : a;
  if (!Number.isFinite(i) || !Number.isFinite(a)) return false;
  return Math.abs(i - a) <= FOR_YOU_WARM_RADIUS || Math.abs(i - l) <= FOR_YOU_WARM_RADIUS;
}

/**
 * Neighbor: prepare/buffer only — paused + muted (DESIGN §4). Active: play.
 * @returns {{ shouldPlay: boolean, isMuted: boolean, role: string }}
 */
export function playbackFlags({
  index,
  activeIndex,
  cellActive,
  feedMuted = false,
  paused = false,
}) {
  const role = roleForIndex(index, activeIndex);
  if (role === 'none') {
    return { shouldPlay: false, isMuted: true, role };
  }
  if (role === 'neighbor') {
    // Warm = bind+prepare via shouldLoad; do not play muted (wastes decode / drifts from t=0).
    return { shouldPlay: false, isMuted: true, role };
  }
  const playing = !!cellActive && !paused;
  return {
    shouldPlay: playing,
    isMuted: feedMuted || !cellActive,
    role,
  };
}
