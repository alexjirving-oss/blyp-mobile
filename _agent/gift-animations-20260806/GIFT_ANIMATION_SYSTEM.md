# Blyp Gift Animation System

**Date:** 2026-08-06  
**Worktree:** `C:\Users\Alex\Blyp26-eas-modern`  
**Status:** P0 cinematic set shipped (production-wired)

Companion canvas: [gift-animations-system.canvas.tsx](../../.cursor/projects/c-Users-Alex-Blyp26/canvases/gift-animations-system.canvas.tsx) (open beside chat).

---

## Phase A — Reality audit (honest)

### What we had

| Surface | Before |
|---------|--------|
| Live overlay | Emoji + RN `Animated` banners, combo fuse, generic epic/legendary rays |
| Feed / GiftSystem | Heart choreography + weak scale-fade for everything else |
| Assets | Unicode emoji only — **no** Lottie, Rive, Skia, Reanimated, gift MP4s |
| Sound | None |
| Catalog | Postgres `gift_catalog` + Socket.IO `gift_event` — plumbing was already solid |

### Vs TikTok-class

TikTok wins on dedicated per-SKU video/Lottie, sound sync, 3D-ish assets, and art pipeline. Blyp’s gap was **playback craft + identity**, not send/economy wiring.

### Constraints kept

- No new heavy native deps (Skia / Reanimated / Lottie) for this ship.
- Stack: `Animated` (native driver) + `expo-linear-gradient` + `react-native-svg` + `expo-haptics`.
- `expo-av` audio hooks are **placeholder-gated** until designers drop SFX.

---

## Phase B — Motion design system

### Tier taxonomy (coin → treatment)

| Tier | Coin band | Takeover | Screen share | Combo visual mult | Skip |
|------|-----------|----------|--------------|-------------------|------|
| Small | ≤5 | none (floaters + burst) | ~18% | 1.0 | no |
| Mid | ≤20 | spotlight | ~42% | 1.15 | no |
| Epic | ≤40 | fullscreen | ~72% | 1.35 | yes |
| Legendary | ≤80 | fullscreen | ~90% | 1.55 | yes |
| Ultimate | 81+ | fullscreen | 100% | 1.8 | yes |

### Timeline (every hero)

1. **Entrance** — anticipation scale, vignette in, haptic  
2. **Climax** — motif-specific FX (launch / prism / flame / …) + particle wave  
3. **Linger** — bob/glow loops, sender pill + tier chip  
4. **Exit** — scale-out + vignette fade (or tap-to-skip)

### Identity

- Primary: Mercedes-AMG PETRONAS teal (`#00D2BE`)  
- Energy accents: amber / red for heat combos  
- Gold: legendary climax only — **not** purple AI sludge  
- Sport/live culture: stadium wave, flame column, orbital launch

### Motion principles

Weight, anticipation, follow-through, sparse camera shake (legendary+), depth layers (vignette / rays / SVG / emoji / particles), light blooms, particle craft with hard caps.

### Audio

`playGiftAudio(audioKey)` no-ops until `registerGiftAudio(key, require(...))` is called with real modules under `assets/sounds/gifts/`.

---

## Phase C — P0 shipped (wired)

| Gift | Cost | Motif | Look |
|------|------|-------|------|
| Heart | 1 | `pulse_bloom` | Teal energy bloom + heartbeat floaters |
| Clap | 5 | `shock_clap` | Shockwave clap + teal/amber particles |
| Fire | 10 | `flame_column` | Mid spotlight + rising flame column |
| Star | 15 | `constellation` | Orbiting constellation SVG + gold/teal |
| Diamond | 25 | `crystal_prism` | Fullscreen prism facets + crystal burst |
| Cheer Burst | 25 | `stadium_wave` | Horizontal stadium energy bands |
| Crown | 50 | `regal_drop` | Gold/teal halo drop + shake |
| Rocket | 100 | `orbital_launch` | Bottom→sky launch, exhaust trail, ultimate hold |

### Integration

- **Viewers + sender on live:** `LiveStreamScreen` → socket `gift_event` → `LiveGiftOverlay` → `GiftHeroFx`
- **Sender confirm (modal):** `GiftSystem.triggerGiftAnimation` (heart path + anticipation spring for others)
- **Catalog:** `asset_json` now carries `motionTier` + `motif` (admin toggles / enable flags unchanged)
- **Combo:** teal→orange→gold heat labels (`STREAK` / `HOT` / `ON FIRE` / `ULTIMATE`), fuse bar retained
- **Tap-to-skip:** epic+ hero; container `pointerEvents="box-none"` so live UI stays usable

### Code map

```
src/components/live/giftMotion/giftMotionSystem.js   # tiers, catalog, budgets, audio gate
src/components/live/giftMotion/GiftHeroFx.js          # motif stages + skip
src/components/live/LiveGiftOverlay.js               # playback surface
src/components/GiftSystem.js                         # picker palette + sender confirm
src/services/BlypCoinService.js                      # fallback catalog (+ cheer/revive)
backend/.../economy/schema.ts                        # seeded asset_json motion keys
```

---

## Phase D — Catalog roadmap

| Priority | Gifts | Work |
|----------|-------|------|
| **P0** | heart, clap, fire, star, diamond, cheer_burst, crown, rocket | **Done** (procedural cinematic) |
| **P1** | thumbsup, revive | Motif polish + dedicated SFX; revive life-ring art |
| **P2** | New SKUs (limited / seasonal) | Designer Lottie or short WebM per SKU; tray tabs |
| **P3** | Feed shared visibility, top-fans strip, quantity multi-send | Product + backend |

Admin gift enable/disable remains compatible — motion keys live in `asset_json` and do not affect economy math.

---

## Perf notes

| Device budget | Particles | Floaters | Rays | SVG | Shake |
|---------------|-----------|----------|------|-----|-------|
| high (≥7GB / year≥2023) | 72 | 18 | 8 | yes | yes |
| mid (default) | 48 | 14 | 6 | yes | yes |
| low (<3.5GB / year<2020) | 24 | 8 | 4 | off | off |

Target: **60fps** mid Android; Fold7-class runs high budget. Caps trim oldest particles. Native-driver transforms only on hot paths.

---

## Designer ask (still needed)

1. Per-gift **SFX** (mp3/wav) for keys: `gift_heart`, `gift_clap`, `gift_fire`, `gift_star`, `gift_diamond`, `gift_cheer`, `gift_crown`, `gift_rocket`  
2. Optional **Lottie/Rive** replacements for rocket + crown + diamond (drop-in when we add a player)  
3. **Icon tiles** for picker (not emoji) at 3× for retina  
4. Optional short **MP4 alpha** gifts for ultimate tier only  

Until then, procedural teal/sport FX is the production path.
