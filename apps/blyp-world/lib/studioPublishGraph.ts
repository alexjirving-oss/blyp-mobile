/**
 * Stage audio routing. Empty Web Audio dest tracks encode as hiss —
 * never publish the mix destination unless a real bed/tab-share is live.
 */

export type PublishAudioSource = "mix" | "gum";

export function planPublishAudio(input: {
  wantMix: boolean;
  mixTrackLive: boolean;
  gumTrackLive: boolean;
}): PublishAudioSource {
  if (input.wantMix && input.mixTrackLive) return "mix";
  return "gum";
}

export function wantPublishMix(input: {
  localMusicPlaying: boolean;
  tabOrElementMusic: boolean;
}): boolean {
  return !!(input.localMusicPlaying || input.tabOrElementMusic);
}
