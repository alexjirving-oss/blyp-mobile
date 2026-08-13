/**
 * For You / feed playback audio session.
 * On claim: reclaim speaker (MODE_NORMAL is not enough — pin builtin SPEAKER).
 * Do not touch the player.
 */

import { reclaimMediaPlaybackRoute } from '../services/notifySound';

let ownerToken = null;
let modePromise = null;
// Only a call / blur can steal the route. Re-asserting it on every swipe means a
// setAudioModeAsync per cell, which cuts the audio of the clip already playing.
let routeDirty = true;

export function getFeedAudioOwner() {
  return ownerToken;
}

/**
 * A call, a screen blur, or anything else that may have taken the voice route.
 * The next For You claim re-pins the speaker instead of trusting the last one.
 */
export function markFeedAudioRouteDirty() {
  routeDirty = true;
}

/**
 * Claim audible ownership for the active For You cell.
 * @param {string} token stable id (usually post id)
 * @returns {Promise<boolean>} true if this token owns audio after claim
 */
export async function claimFeedAudio(token) {
  const id = token != null ? String(token) : '';
  if (!id) return false;
  ownerToken = id;
  if (!routeDirty) return ownerToken === id;
  if (!modePromise) {
    modePromise = (async () => {
      await reclaimMediaPlaybackRoute();
      routeDirty = false;
    })()
      .catch(() => {})
      .finally(() => {
        modePromise = null;
      });
  }
  await modePromise;
  return ownerToken === id;
}

export function releaseFeedAudio(token) {
  const id = token != null ? String(token) : '';
  if (!id) return;
  if (ownerToken === id) ownerToken = null;
}

export function isFeedAudioOwner(token) {
  const id = token != null ? String(token) : '';
  return !!id && ownerToken === id;
}
