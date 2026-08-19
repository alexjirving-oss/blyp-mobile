/**
 * Keep in lockstep with lib/studioPublishGraph.ts
 * Run: node scripts/studio-publish-graph-test.mjs
 */

function planPublishAudio(input) {
  if (input.wantMix && input.mixTrackLive) return "mix";
  return "gum";
}

function wantPublishMix(input) {
  return !!(input.localMusicPlaying || input.tabOrElementMusic);
}

const planCases = [
  [{ wantMix: false, mixTrackLive: true, gumTrackLive: true }, "gum"],
  [{ wantMix: false, mixTrackLive: false, gumTrackLive: true }, "gum"],
  [{ wantMix: true, mixTrackLive: false, gumTrackLive: true }, "gum"],
  [{ wantMix: true, mixTrackLive: false, gumTrackLive: false }, "gum"],
  [{ wantMix: true, mixTrackLive: true, gumTrackLive: true }, "mix"],
  [{ wantMix: true, mixTrackLive: true, gumTrackLive: false }, "mix"],
];

for (const [input, expected] of planCases) {
  const got = planPublishAudio(input);
  if (got !== expected) {
    console.error("planPublishAudio FAIL", input, "got", got, "expected", expected);
    process.exit(1);
  }
}

const mixCases = [
  [{ localMusicPlaying: false, tabOrElementMusic: false }, false],
  [{ localMusicPlaying: true, tabOrElementMusic: false }, true],
  [{ localMusicPlaying: false, tabOrElementMusic: true }, true],
];

for (const [input, expected] of mixCases) {
  const got = wantPublishMix(input);
  if (got !== expected) {
    console.error("wantPublishMix FAIL", input, "got", got, "expected", expected);
    process.exit(1);
  }
}

console.log("studioPublishGraph PASS");
