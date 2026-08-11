/**
 * For You–only audible ownership.
 * Does not touch LIVE / Agora session helpers.
 * Warm neighbors never claim; only the unmuted active cell owns audio.
 */

import {
  claimFeedAudio,
  releaseFeedAudio,
  isFeedAudioOwner,
  getFeedAudioOwner,
} from '../services/feedAudioSession';

/**
 * @param {{ audioOwnerId: string|null, shouldPlay: boolean, isMuted: boolean, shouldLoad: boolean }} opts
 * @returns {Promise<boolean>} whether this id owns audible after attempt
 */
export async function syncForYouAudioOwnership({
  audioOwnerId,
  shouldPlay,
  isMuted,
  shouldLoad,
}) {
  const id =
    audioOwnerId != null && String(audioOwnerId).trim()
      ? String(audioOwnerId)
      : null;
  if (!id) return false;
  if (!shouldLoad || !shouldPlay || isMuted) {
    releaseFeedAudio(id);
    return false;
  }
  return claimFeedAudio(id);
}

export function releaseForYouAudio(audioOwnerId) {
  releaseFeedAudio(audioOwnerId);
}

export function isForYouAudioOwner(audioOwnerId) {
  return isFeedAudioOwner(audioOwnerId);
}

export function getForYouAudioOwner() {
  return getFeedAudioOwner();
}
