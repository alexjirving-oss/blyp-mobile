/**
 * Instant For You audio — claim speaker once per panel visit.
 * Do not re-setAudioMode on every swipe.
 */

import {
  reclaimMediaPlaybackRoute,
  invalidateMediaPlaybackAudioMode,
} from '../../services/notifySound';

let claimed = false;
let claimPromise = null;

export function nativeMuted({ shouldPlay, isMuted }) {
  return !shouldPlay || !!isMuted;
}

/** One speaker reclaim when entering For You (focused + unmuted). */
export async function ensureInstantAudio(opts = {}) {
  const { force = false } = opts;
  if (claimed && !force) return true;
  if (!claimPromise) {
    claimPromise = (async () => {
      if (force) invalidateMediaPlaybackAudioMode();
      await reclaimMediaPlaybackRoute();
      claimed = true;
    })()
      .catch(() => {
        claimed = false;
      })
      .finally(() => {
        claimPromise = null;
      });
  }
  await claimPromise;
  return claimed;
}

export function releaseInstantAudio() {
  claimed = false;
}

export function isInstantAudioClaimed() {
  return claimed;
}
