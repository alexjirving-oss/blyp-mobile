# Blyp Gift Cinematic V2 — Motion Bible

**Date:** 2026-08-06  
**Worktree:** `C:\Users\Alex\Blyp26-eas-modern`  
**Status:** V2 player + 5 hero Skia cinemas shipped  
**Supersedes craft bar of:** P0 `1fe0dcd` (teal particle / emoji overlays — **rejected**)

Companion canvas: `gift-animations-system.canvas.tsx`

---

## Honest craft bar (read this first)

| Claim | Truth |
|-------|--------|
| “Rival Disney / Pixar” **in-app** | Theatrical **gift cinema**: authored timelines, stage lighting, impact frames, hold-for-glory, diegetic chrome, 60fps Skia choreography |
| True Pixar film renders | **Impossible** as RN particles. Needs EXR/USD, LookDev, film comp, proprietary render farms |
| What we ship now | Procedural Skia vector heroes + Reanimated phase clock — **not** emoji shocks |
| What still needs a motion designer | Alpha WebM/MP4 per Ultimate SKU, Rive state machines, authored SFX beds, HDR grade LUTs, hand-keyed secondary animation |

**In-app Pixar-rival = gasp from craft of timing, light, and silhouette — not claiming we shipped Toy Story frames.**

---

## Why P0 failed the bar

- Hero read as **Unicode emoji** with teal SVG halos and emoji particle spam
- Shared “rays + rings + pill” chrome made every gift feel like one motif with a sticker swap
- No impact frame, no camera, no chromatic split, no glory hold language
- Looked like a polished reaction sticker pack, not a live event moment

---

## Stack decision (Expo SDK 54)

| Package | Version (pinned via `expo install`) | Role |
|---------|--------------------------------------|------|
| `@shopify/react-native-skia` | `2.2.12` | Vector heroes, bloom, particles, lighting |
| `react-native-reanimated` | `~4.1.1` | 60fps phase clock / camera |
| `react-native-worklets` | `0.5.1` | Reanimated 4 peer |
| `react-native-svg` + `Animated` | existing | Cheap-tier floaters / banners |

**Not installed this pass:** `rive-react-native` (needs designer `.riv` assets + config plugin), `lottie-react-native` (no authored Lottie yet). Player is **Rive/Lottie-ready**: hero registry can swap to a video/Rive layer later without rewriting overlay plumbing.

New Architecture: **on** (`android/gradle.properties` → `newArchEnabled=true`) — required for Reanimated 4.

**AAB note:** Skia/Reanimated are native modules → requires a **new EAS build** before production devices show V2. JS-only OTA cannot deliver Skia.

---

## Player contract — `GiftCinematicPlayer`

Phases (normalized `t` 0→1 on Reanimated shared clock):

| Phase | Range (default) | Feel |
|-------|-----------------|------|
| **Black / preload** | 0.00–0.04 | Stage settles; letterbox in |
| **Entrance** | 0.04–0.18 | Anticipation, light up, silhouette reveal |
| **Ignition / impact** | 0.18–0.28 | Hard punch frame + haptic Heavy |
| **Climax** | 0.28–0.62 | Motif-specific camera + FX peak |
| **Glory hold** | 0.62–0.82 | Slow settle, plaque readable, sparkle sustain |
| **Elegant dismiss** | 0.82–1.00 | Scale/fade, letterbox out, no abrupt pop |

Player chrome (shared):
- Film letterbox (epic+)
- HDR-ish grade: lifted blacks, teal key light, warm fill on legendary+
- Stage vignette + soft key bloom (budget-gated)
- Chromatic aberration on impact (R/C channel offset) — mid+ only
- Diegetic sender plaque (not emoji pill)
- Tap-to-skip on epic+; mid fire skippable when `skippable` set
- Optional audio bed via existing `playGiftAudio` gate

---

## Hero cinema set (gasp tier)

| Gift | Motif | Cinema ID | Visual thesis |
|------|-------|-----------|---------------|
| **Rocket** | `orbital_launch` | `rocket` | Ignition flash → exhaust bloom → camera tracks vertical ascent → star streaks → sonic ring → glory silhouette |
| **Crown** | `regal_drop` | `crown` | God-ray descent → gold facet catch-light → teal rim → impact settle on pedestal → spark rain |
| **Diamond** | `crystal_prism` | `diamond` | Facet spin → prismatic caustics → shard burst → bloom pulse → crystal hold |
| **Cheer Burst** | `stadium_wave` | `cheer_burst` | Floodlight strobes → horizontal energy ribbons → confetti shards (geometry, not emoji) → stadium roar particles |
| **Fire** | `flame_column` | `fire` | Ember rise → layered flame core → heat shimmer → ash drift → column glory |

Cheap gifts (heart, clap, thumbs, star, revive) stay on lighter `GiftHeroFx` / floater path — delightful, not theatrical.

---

## Timing budgets (ms)

| Tier | Total hero | Impact haptic | Skip |
|------|------------|---------------|------|
| Mid (Fire cinema) | ~2200 | Medium | optional |
| Epic | ~3200 | Heavy | yes |
| Legendary | ~4200 | Heavy | yes |
| Ultimate | ~5200 | Heavy + light aftershock | yes |

Low device: cut bloom blur, halve particles, disable chromatic split, shorten glory 20%.

---

## Performance rules

1. One Skia `Canvas` per hero; no nested Canvases
2. Prefer `Group` transforms over redrawing path topology every frame
3. Bloom `Blur` only on `budget.tier !== 'low'`
4. Particle count caps from `getFxBudget().cinemaParticles`
5. Tap-skip cancels clock immediately and runs 220ms exit
6. Never block live chat / bottom bar — container stays `pointerEvents="box-none"`; skip hit only on hero stage

---

## Identity (unchanged brand)

- Key: Mercedes-AMG PETRONAS teal `#00D2BE`
- Heat: amber → red
- Legendary metal: gold facets only at climax
- **No purple sludge, no emoji as hero silhouette**

---

## Still needs pro art (honest backlog)

1. Per-SKU **alpha WebM/MP4** (Ultimate) from After Effects / Cavalry / Houdini
2. **Rive** interactive heroes (especially Crown / Rocket) with state machines
3. Authored **SFX beds** + whooshes synced to impact frames
4. **Picker tiles** 3× (not emoji)
5. Colorist pass: true HDR grade LUTs for night-live vs daylight live
6. Secondary animation polish (cloth, sparks, smoke sims) — EXR/USD pipeline

Until then: Skia cinema is the production path for gasp moments.

---

## Code map

```
src/components/live/giftMotion/
  giftMotionSystem.js          # tiers, budgets, cinematicV2 flags
  GiftCinematicPlayer.js       # phase player + chrome
  GiftHeroFx.js                # cheap / non-hero path
  scenes/
    RocketCinema.js
    CrownCinema.js
    DiamondCinema.js
    CheerBurstCinema.js
    FireCinema.js
    cinemaRegistry.js
LiveGiftOverlay.js             # routes hero → GiftCinematicPlayer
```
