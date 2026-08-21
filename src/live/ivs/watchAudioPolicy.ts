/**
 * Throttle JS loudspeaker reasserts on watch paths.
 * Stage watch must use native PUBLISHING (call mode + speaker), same as guest.
 * PLAYBACK / MODE_NORMAL is HLS only. Forcing MODE_NORMAL onto a live Stage
 * fight Samsung's earpiece snap on the UI thread until the user publishes.
 */

export const VIEWER_LOUDSPEAKER_MIN_INTERVAL_MS = 2500;

export function shouldSkipViewerLoudspeakerReassert(
  lastMs: number,
  nowMs: number,
  minIntervalMs: number = VIEWER_LOUDSPEAKER_MIN_INTERVAL_MS,
): boolean {
  if (lastMs <= 0) return false;
  return nowMs - lastMs < minIntervalMs;
}
