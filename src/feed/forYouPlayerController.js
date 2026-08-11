/**
 * Pure For You player window controller — active / warm / cold + seek-to-0 on promote.
 * No storm pool. No native calls.
 */

import {
  FOR_YOU_POOL_SIZE,
  FOR_YOU_WARM_RADIUS,
  roleForIndex,
  shouldLoadCell,
  playbackFlags,
} from './ForYouEngine';

/**
 * @param {{ activeIndex: number, loadIndex?: number, itemCount: number }} opts
 * @returns {{
 *   activeIndex: number,
 *   warmIndexes: number[],
 *   coldOutside: boolean,
 *   slots: Array<{ index: number, role: string, shouldLoad: boolean, shouldPlay: boolean, isMuted: boolean, seekToZero: boolean }>
 * }}
 */
export function planForYouWindow({
  activeIndex,
  loadIndex,
  itemCount,
  feedMuted = false,
  paused = false,
  previousActiveIndex = null,
}) {
  const a = Number(activeIndex);
  const n = Math.max(0, Number(itemCount) || 0);
  const loadCenter = Number.isFinite(Number(loadIndex)) ? Number(loadIndex) : a;
  const prev =
    previousActiveIndex == null || !Number.isFinite(Number(previousActiveIndex))
      ? null
      : Number(previousActiveIndex);

  const warmIndexes = [];
  const slots = [];

  for (let i = 0; i < n; i += 1) {
    const role = roleForIndex(i, a);
    const load = shouldLoadCell(i, a, loadCenter);
    const flags = playbackFlags({
      index: i,
      activeIndex: a,
      cellActive: i === a,
      feedMuted,
      paused,
    });
    const seekToZero = role === 'active' && (prev === null || prev !== a);
    if (role === 'neighbor') warmIndexes.push(i);
    if (role === 'none' && !load) continue;
    slots.push({
      index: i,
      role,
      shouldLoad: load,
      shouldPlay: flags.shouldPlay,
      isMuted: flags.isMuted,
      seekToZero: !!seekToZero && role === 'active',
    });
  }

  return {
    activeIndex: a,
    warmIndexes,
    poolSize: FOR_YOU_POOL_SIZE,
    warmRadius: FOR_YOU_WARM_RADIUS,
    coldOutside: true,
    slots,
  };
}

/**
 * Promote index → active. Always seek-to-0 on the new active.
 */
export function promoteActive(prevPlan, nextActiveIndex, opts = {}) {
  const prevActive = prevPlan?.activeIndex ?? null;
  return planForYouWindow({
    activeIndex: nextActiveIndex,
    loadIndex: opts.loadIndex,
    itemCount: opts.itemCount ?? 0,
    feedMuted: opts.feedMuted,
    paused: opts.paused,
    previousActiveIndex: prevActive,
  });
}
