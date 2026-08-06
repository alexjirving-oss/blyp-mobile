# Gift TikTok-bar overlays — READY

**Date:** 2026-08-06  
**Worktree:** `C:\Users\Alex\Blyp26-eas-modern`  
**Status:** Hero clips rebuilt toward TikTok LIVE gift overlays (dark-key luxury FX). Cartoon character-rig cinema rejected and replaced.

## Commit SHA (feature — bake from this or tip)

```
b1822a5329b22b7ee0404654f5529789274dac32
```

**Short:** `b1822a5`  
**Message:** `feat(gifts): raise hero FX to TikTok-class gift overlays`

Docs tip: `84821cf` (ready note + bar bible + commission brief). Clips + player are in `b1822a5` and remain in descendants.

## What improved vs a686268 Canvas rigs

| Before (rejected) | Now |
|-------------------|-----|
| Googly-eye character cinema | No faces — metallic/jeweled/crystal/flame props |
| Letterboxed movie blackout | Transparent overlay root + soft vignette |
| Ken Burns / stick figures | Dense bloom, glitter, shockwaves, confetti |
| Flat plate | Pixabay sparkle plate (screen, warm-shifted) + procedural heroes |
| Player = cinema stage | Glow plate, impact flash, haptic @ peak, screen blend |

## What still falls short of TikTok's best paid gifts

- **Not true AlphaPlayer / YYEVA alpha video** — Android still uses dark-key H.264; soft edges are approximate
- **Not studio 3D PBR** (cars, castles, character performances) — procedural 2D + stock glitter
- Hero props still read as **high-end motion graphics**, not Unreal/Cinema masters
- No commissioned AE/PAG packs yet — see `MOTION_DESIGNER_COMMISSION_BRIEF.md`

## Paths

| Path | Role |
|------|------|
| `assets/gifts/cinema/clips/{rocket,crown,diamond,cheer_burst,fire}.mp4` | Bundled hero FX (720x1280 @ 30fps) |
| `src/components/live/giftMotion/GiftFilmPlayer.js` | Overlay composite player |
| `src/components/live/giftMotion/filmClipRegistry.js` | Timing / impact meta |
| `_agent/gift-animations-20260806/TIKTOK_GIFT_BAR.md` | Visual bar bible |
| `_agent/gift-animations-20260806/MOTION_DESIGNER_COMMISSION_BRIEF.md` | Commission next leap |
| `_agent/gift-animations-20260806/tiktok-bar-pipeline/` | Re-render pipeline |
| `C:\Users\Alex\Desktop\Blyp-Gift-Animations-Copy\previews\film-reel.html` | Desktop preview reel |

## Preview

```
C:\Users\Alex\Desktop\Blyp-Gift-Animations-Copy\previews\film-reel.html
```

## Clip timing

| Gift | durationMs | impactAt |
|------|------------|----------|
| rocket | 3400 | 0.28 |
| crown | 3200 | 0.42 |
| diamond | 3300 | 0.34 |
| cheer_burst | 3200 | 0.30 |
| fire | 3300 | 0.30 |

## AAB / Play

**Do not upload** until Alex asks. Bake optional.
