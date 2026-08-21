/**
 * Throttle JS loudspeaker reasserts on watch paths.
 * Native Stage watch uses PLAYBACK (media/speaker). Do not hammer AudioManager
 * from JS — that is what froze likes/leave on Samsung.
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
