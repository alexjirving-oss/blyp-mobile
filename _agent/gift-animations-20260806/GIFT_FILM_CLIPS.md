# Blyp Gift Film Clips — Children’s-film pivot

**Date:** 2026-08-06  
**Worktree:** `C:\Users\Alex\Blyp26-eas-modern`  
**Status:** Hero gifts play **authored cinematic MP4 clips** via `GiftFilmPlayer`  
**Supersedes craft bar of:** Skia geometric V2 (`d18a7b4`) — rejected as “moving emojis”

---

## Honest craft bar

| Claim | Truth |
|-------|--------|
| In-app experience | Short **theatrical gift cinema** — character, story beat, lighting, glory freeze |
| True Pixar / Toy Story | Needs ongoing art pipeline (LookDev, animation, lighting, SFX). **Not** what RN shapes can ship |
| What we ship now | ~3s authored H.264 clips + film player chrome (letterbox, plaque, haptics, skip) |
| Skia V2 | Kept only as **cheap fallback** if a clip asset is missing |

Someone watching should feel a **tiny story beat**, not a sticker bounce.

---

## Why Skia V2 failed the bar

- Vector geometry + particles still read as **emoji-adjacent** motion graphics
- HTML review pack / geometric silhouettes ≠ character cinema
- No protagonist, no beat structure that lands an emotional “ooooh”

---

## Architecture

```
LiveGiftOverlay
  └─ GiftCinematicPlayer
       ├─ GiftFilmPlayer  ← primary (expo-av Video + chrome)
       └─ GiftSkiaCinemaFallback  ← only if film asset missing
```

| Piece | Role |
|-------|------|
| `GiftFilmPlayer.js` | Fullscreen/letterboxed MP4, impact haptics, glory hold freeze, tap-skip, audio bed slot |
| `filmClipRegistry.js` | Metro `require()` of clips + timing meta |
| `assets/gifts/cinema/clips/*.mp4` | Bundled hero films (H.264, yuv420p, 1280×720) |
| `assets/gifts/cinema/storyboards/*.png` | Keyframe art used to compose clips |
| Skia `scenes/*Cinema.js` | Fallback only |

---

## Hero film set

| Gift | Clip | Beat |
|------|------|------|
| **Rocket** | `rocket.mp4` (~3.2s) | Toy rocket with eyes — pad anticipation → ignition → ascent → star glory |
| **Crown** | `crown.mp4` (~2.8s) | Jeweled crown character descends and crowns the stage |
| **Diamond** | `diamond.mp4` (~2.9s) | Diamond character facet-dance into light burst |
| **Cheer Burst** | `cheer_burst.mp4` (~2.9s) | Stadium figures erupt in celebration wave |
| **Fire** | `fire.mp4` (~2.9s) | Phoenix fire-spirit rises from embers to glory |

Asset root:

```
assets/gifts/cinema/
  clips/{rocket,crown,diamond,cheer_burst,fire}.mp4
  storyboards/{rocket,crown,diamond,cheer,fire}-*.png
```

---

## Pipeline (how clips were made)

1. **Storyboard stills** — GenerateImage, Pixar-*quality bar* original characters (not franchise IP)
2. **Compose** — `film-pipeline/compose-clips.ps1`  
   ken-burns segments (ffmpeg `zoompan`) → `xfade` chain → H.264 `+faststart`
3. **Bundle** — Metro asset require in `filmClipRegistry.js`
4. **Player** — `expo-av` `Video`, muted plate + optional `playGiftAudio` bed

Re-run compose:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File `
  _agent\gift-animations-20260806\film-pipeline\compose-clips.ps1
```

---

## Preview outside the app

Open the Desktop reel (copied after each ship):

```
C:\Users\Alex\Desktop\Blyp-Gift-Animations-Copy\previews\film-reel.html
```

Or play any clip directly:

```powershell
start assets\gifts\cinema\clips\rocket.mp4
# or
ffplay -autoexit assets\gifts\cinema\clips\rocket.mp4
```

In-app: send Rocket / Crown / Diamond / Cheer Burst / Fire in a live room (requires build that includes the new assets — OTA OK if expo-av already in binary).

---

## What true Pixar still needs

- Hand-keyed / Rive character animation (not still morphs)
- Authored SFX beds + mix
- Alpha WebM / premultiplied plates for live composite over stream
- Motion designer iteration loop per SKU

This pass stops the **emoji feel**. Raising to feature-film craft is an art pipeline, not another Skia pass.
