# Gift true-motion cinema — READY for AAB

**Date:** 2026-08-06  
**Worktree:** `C:\Users\Alex\Blyp26-eas-modern`  
**Status:** Slideshow / Ken Burns hero clips **rejected and replaced** with continuous 30fps character-rig cinema.

## Commit SHA (use this for Play AAB bake)

```
29588f329a6acbc8f45a70a2cd7b373e4ea28b77
```

*(Filled immediately after `git commit` — see bottom of this file / re-read after commit.)*

## What changed

| Path | Change |
|------|--------|
| `assets/gifts/cinema/clips/{rocket,crown,diamond,cheer_burst,fire}.mp4` | Replaced — true motion H.264 @ 1280×720 / 30fps |
| `src/components/live/giftMotion/filmClipRegistry.js` | Duration / impact timing aligned to new clips |
| `GiftFilmPlayer.js` | Unchanged (player stays) |
| Desktop `Blyp-Gift-Animations-Copy/clips/*.mp4` + `previews/film-reel.html` | Synced |

## How motion was authored

**Method:** Procedural Canvas character-rig → high frame-count PNG sequence → ffmpeg `libx264`

- Renderer: `_agent/gift-animations-20260806/true-motion-pipeline/render-true-motion.mjs`
- Engine: `@napi-rs/canvas` draws the full scene **every frame** (not zoompan / xfade on stills)
- Each gift: anticipation → impact → follow-through → glory (~3.0–3.3s, 90–99 frames @ 30fps)
- Continuous elements: squash/stretch, arcs, blinks, exhaust/wing flicker, particle systems, confetti
- Storyboard PNGs kept for art reference only — **not** used as hero slideshow plates
- No AI video API credentials were present; minterpolate was **not** used as fake motion from stills

Re-render:

```powershell
cd _agent\gift-animations-20260806\true-motion-pipeline
npm install
node render-true-motion.mjs
```

## Clip timing (player meta)

| Gift | durationMs | impactAt | frames |
|------|------------|----------|--------|
| rocket | 3300 | 0.26 | 99 |
| crown | 3000 | 0.42 | 90 |
| diamond | 3100 | 0.32 | 93 |
| cheer_burst | 3100 | 0.30 | 93 |
| fire | 3100 | 0.28 | 93 |

## Quality gate

Opened QC frames at ~0.3s / 1.0s / 1.8s / 2.6s per clip:

- Character **position/pose changes every sample** (not crossfaded storyboards)
- Consecutive source PNG hashes differ (true per-frame redraw)
- Visual check: does **not** read as PowerPoint / Ken Burns

Preview reel:

```
C:\Users\Alex\Desktop\Blyp-Gift-Animations-Copy\previews\film-reel.html
```

## AAB agent handoff

1. Checkout / use commit SHA above on `Blyp26-eas-modern`
2. Bake Play AAB with bundled `assets/gifts/cinema/clips/*.mp4`
3. Upload only when Alex asks (`npm run play:upload`)

---

## Resolved commit SHA

```
29588f329a6acbc8f45a70a2cd7b373e4ea28b77
```
