/**
 * Pause Spotify when Blyp takes the audio focus (unmuted For You, live, calls).
 * Soft-fail: never block feed/live if Spotify API is unreachable.
 */
import { pauseSpotifyPlayback, getSpotifyLinkStatus } from './spotifyConnectService';

let lastPauseAt = 0;
const MIN_GAP_MS = 1200;

export async function pauseSpotifyForBlypAudio(reason = 'blyp_audio') {
  const now = Date.now();
  if (now - lastPauseAt < MIN_GAP_MS) return { skipped: true, reason: 'throttle' };
  lastPauseAt = now;
  try {
    const status = await getSpotifyLinkStatus();
    if (!status.linked) return { skipped: true, reason: 'not_linked' };
    await pauseSpotifyPlayback();
    if (__DEV__) {
      console.log('[SPOTIFY] paused for', reason);
    }
    return { ok: true, reason };
  } catch (e) {
    if (__DEV__) {
      console.warn('[SPOTIFY] pause skipped', e?.message || e);
    }
    return { ok: false, error: String(e?.message || e) };
  }
}

export default { pauseSpotifyForBlypAudio };
