/**
 * Watch-only audio: Stage WebRTC snaps the Fold to earpiece, then the
 * loudspeaker watchdog used to clear/set the communication device on the
 * UI thread every 500ms. Likes and leave share that thread, so the app
 * looked crashed. Throttle JS reasserts; native PLAYBACK must not sandwich
 * into MODE_IN_COMMUNICATION.
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
