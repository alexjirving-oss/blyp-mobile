/**
 * Instant For You engine — active ±1 warm window.
 * Promote = unmute in place. Never seek active to 0.
 */

export const INSTANT_POOL_SIZE = 3;
export const INSTANT_WARM_RADIUS = 1;

export function roleForIndex(index, activeIndex) {
  const i = Number(index);
  const a = Number(activeIndex);
  if (!Number.isFinite(i) || !Number.isFinite(a)) return 'none';
  const dist = Math.abs(i - a);
  if (dist === 0) return 'active';
  if (dist <= INSTANT_WARM_RADIUS) return 'neighbor';
  return 'none';
}

export function shouldLoadCell(index, activeIndex, loadIndex = activeIndex) {
  const i = Number(index);
  const a = Number(activeIndex);
  const l = Number.isFinite(Number(loadIndex)) ? Number(loadIndex) : a;
  if (!Number.isFinite(i) || !Number.isFinite(a)) return false;
  return Math.abs(i - a) <= INSTANT_WARM_RADIUS || Math.abs(i - l) <= INSTANT_WARM_RADIUS;
}

/**
 * Neighbors: muted decode (opening in RAM).
 * Active: audible play. Never emits seekToZero.
 */
export function playbackFlags({
  index,
  activeIndex,
  feedMuted = false,
  paused = false,
}) {
  const role = roleForIndex(index, activeIndex);
  if (role === 'none') {
    return { shouldPlay: false, isMuted: true, role, seekToZero: false };
  }
  if (role === 'neighbor') {
    return { shouldPlay: true, isMuted: true, role, seekToZero: false };
  }
  return {
    shouldPlay: !paused,
    isMuted: !!feedMuted,
    role,
    seekToZero: false,
  };
}

export function planWindow({
  activeIndex,
  loadIndex,
  itemCount,
  feedMuted = false,
  paused = false,
}) {
  const a = Number(activeIndex);
  const n = Math.max(0, Number(itemCount) || 0);
  const loadCenter = Number.isFinite(Number(loadIndex)) ? Number(loadIndex) : a;
  const warmIndexes = [];
  const slots = [];

  for (let i = 0; i < n; i += 1) {
    const role = roleForIndex(i, a);
    const load = shouldLoadCell(i, a, loadCenter);
    const flags = playbackFlags({
      index: i,
      activeIndex: a,
      feedMuted,
      paused,
    });
    if (role === 'neighbor') warmIndexes.push(i);
    if (role === 'none' && !load) continue;
    slots.push({
      index: i,
      role,
      shouldLoad: load,
      shouldPlay: flags.shouldPlay,
      isMuted: flags.isMuted,
      seekToZero: false,
    });
  }

  return {
    activeIndex: a,
    warmIndexes,
    poolSize: INSTANT_POOL_SIZE,
    warmRadius: INSTANT_WARM_RADIUS,
    slots,
  };
}
