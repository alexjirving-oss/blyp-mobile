/**
 * Process-wide latches for active IVS live audio.
 *
 * expo-av's setAudioModeAsync (playThroughEarpieceAndroid: false) forces
 * AudioManager.MODE_NORMAL on Android — yanking host/guest out of
 * MODE_IN_COMMUNICATION + VIDEO_CHAT (call volume / AEC). Gift films and
 * media stings must refuse that claim while Stage is live.
 *
 * `stagePublishing` — mic-open host/guest path (strictest).
 * `liveAudioActive` — any live path including subscribe-only / HLS viewer.
 */

let stagePublishing = false;
let liveAudioActive = false;

export function setLiveStagePublishing(active) {
  stagePublishing = !!active;
}

export function isLiveStagePublishing() {
  return stagePublishing;
}

export function setLiveAudioSessionActive(active) {
  liveAudioActive = !!active;
}

export function isLiveAudioSessionActive() {
  return liveAudioActive || stagePublishing;
}
