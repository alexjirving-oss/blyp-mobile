/**
 * For You–only audible ownership.
 * Does not touch LIVE / Agora session helpers.
 * Warm neighbors never claim; only the unmuted active cell owns audio.
 *
 * Native mute follows playbackFlags (isMuted / shouldPlay). Session claim only
 * sets loudspeaker mode — it must never remute the active cell while waiting.
 */

import {
  claimFeedAudio,
  releaseFeedAudio,
  isFeedAudioOwner,
  getFeedAudioOwner,
} from '../services/feedAudioSession';

/**
 * Native `muted` for BlypShorts. Neighbors stay silent via isMuted; paused
 * cells stay silent via !shouldPlay. Do not fold in async audio-session ownership.
 */
export function forYouNativeMuted({ shouldPlay, isMuted }) {
  return !shouldPlay || !!isMuted;
}

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
