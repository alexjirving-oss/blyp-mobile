# Blyp Gift Film Clips — True motion (supersedes Ken Burns pass)

**Date:** 2026-08-06  
**Worktree:** `C:\Users\Alex\Blyp26-eas-modern`  
**Status:** Hero gifts play **continuous 30fps character-rig MP4s** via `GiftFilmPlayer`  
**Supersedes:** `d295284` slideshow / zoompan / xfade storyboard compose (user rejected)

See also: `_agent/GIFT_TRUE_MOTION_READY.md` (SHA for AAB agent).

---

## Honest craft bar

| Claim | Truth |
|-------|--------|
| In-app experience | Short theatrical gift cinema with **continuous character motion** |
| Not a slideshow | Every frame redraws animated rigs + particles (Canvas → PNG → ffmpeg) |
| True Pixar / Toy Story EXR | Still needs ongoing art pipeline — this is children's-film **grammar**, not feature LookDev |
| Skia V2 | Kept only as cheap fallback if a clip asset is missing |

---

## Architecture

```
LiveGiftOverlay
  └─ GiftCinematicPlayer
       ├─ GiftFilmPlayer  ← primary (expo-av Video + chrome)
       └─ GiftSkiaCinemaFallback  ← only if film asset missing
```

---

## Pipeline (true motion)

1. **Author** — `true-motion-pipeline/render-true-motion.mjs`  
   Procedural Canvas character rigs @ 30fps (anticipation, arcs, squash/stretch, particles)
2. **Encode** — ffmpeg H.264 yuv420p 1280×720 `+faststart`
3. **Bundle** — Metro `require()` in `filmClipRegistry.js`
4. **Player** — `GiftFilmPlayer` unchanged; timing meta updated

```powershell
cd _agent\gift-animations-20260806\true-motion-pipeline
npm install
node render-true-motion.mjs
```

---

## Hero film set

| Gift | Clip | Beat |
|------|------|------|
| **Rocket** | `rocket.mp4` (~3.3s) | Anticipate → ignition → ascent → star glory |
| **Crown** | `crown.mp4` (~3.0s) | Descend, bounce settle, stage crown flash |
| **Diamond** | `diamond.mp4` (~3.1s) | Reveal, facet spin/dance, light burst |
| **Cheer Burst** | `cheer_burst.mp4` (~3.1s) | Wave jump + continuous confetti |
| **Fire** | `fire.mp4` (~3.1s) | Ember rise, wing flap, glory bloom |

```
assets/gifts/cinema/clips/{rocket,crown,diamond,cheer_burst,fire}.mp4
```

Desktop preview:

```
C:\Users\Alex\Desktop\Blyp-Gift-Animations-Copy\previews\film-reel.html
```
