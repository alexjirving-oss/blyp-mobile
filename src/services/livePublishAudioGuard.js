/**
 * Process-wide latch: IVS Stage host/guest publish is active.
 *
 * expo-av's ensureMediaPlaybackAudioMode / setAudioModeAsync can yank Android out of
 * MODE_IN_COMMUNICATION + VIDEO_CHAT (call volume / AEC) into media playback. While a
 * publisher mic is open that drift is the Fold screech path — refuse media-mode claims.
 */

let stagePublishing = false;

export function setLiveStagePublishing(active) {
  stagePublishing = !!active;
}

export function isLiveStagePublishing() {
  return stagePublishing;
}
