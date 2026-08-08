/**
 * For You / feed playback audio session.
 *
 * Live, speech-to-text, voice memos, and notify stings can leave the process in
 * PlayAndRecord / MODE_IN_COMMUNICATION (earpiece). Feed video must re-assert
 * loudspeaker media mode before unmuting the active clip.
 *
 * Also serializes "who owns audible playback" so preload neighbors cannot steal
 * Android audio focus with mute/pause spam.
 */

import { ensureMediaPlaybackAudioMode } from '../services/notifySound';

let ownerToken = null;
let modePromise = null;

export function getFeedAudioOwner() {
  return ownerToken;
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
  if (!modePromise) {
    modePromise = ensureMediaPlaybackAudioMode({ background: false })
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
