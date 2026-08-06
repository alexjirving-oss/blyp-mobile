# TikTok LIVE gift bar — visual reference bible

**Purpose:** Define what “good enough” means for Blyp hero gifts. Prior Canvas character-rig / Ken Burns / Skia emoji paths fail this bar.

## What TikTok actually ships

Premium TikTok LIVE gifts are **authored commercial overlays**, not app-drawn cartoons.

| Delivery tech | Why it wins |
|---------------|-------------|
| **Alpha-channel video** (AlphaPlayer / YYEVA / VAP — RGB+A side-by-side or dual-track MP4) | Soft edges, bloom, smoke, glitter composite over live without a black plate |
| **PAG / high-end Lottie** | Designer AE → deterministic vector/particle playback |
| **Pre-rendered 3D** (Blender/Cinema/Unreal stills→video) | Studio lighting, PBR metals/glass, character performances for top-coin gifts |

Industry writeups (ByteDance AlphaPlayer, YY YYEVA, Tencent gift SDK) agree: complex live gifts outgrow Lottie when masks/mattes/3D filters appear; **transparent video** is the production path for expensive gifts.

## Frame-by-frame bar (what “good” looks like)

### 0.00–0.15s — Entrance
- Instant **screen presence**: soft vignette or bloom plate, not a hard black fullscreen wipe.
- Subject reads **large** (≈55–90% of shorter screen edge) — center stage or full-bleed takeover.
- Edges of FX are **soft / luminous**; never hard rectangle video matte.

### 0.15–0.45s — Anticipation / build
- Material reads **luxury**: gold metal, crystal, chrome, silk flame — specular highlights + rim light.
- Micro-motion: shimmer, facet tick, particle pre-roll, heat haze — never a static sticker.
- Live host remains faintly readable behind dark areas (true alpha or dark-key composite).

### Impact frame (gift-specific, usually ~25–45% of clip)
- One **clear climax beat**: detonation, crowning contact, prism shatter, confetti cannon, flame bloom.
- **Synced haptic** on that exact frame (heavy for legendary+).
- Brief **white/gold flash** + shockwave ring / bloom overshoot.
- Particles **explode outward** (hundreds of sparks/glitter for epic+), not 12 emoji glyphs.

### Aftermath → glory hold
- Trailing glitter / smoke / light shafts continue 0.4–1.0s.
- Subject **settles** (scale settle, soft rotate) — not freeze mid-rig pose.
- Optional last-frame glory hold ≤1.1s, then soft fade; tap-to-skip always available on epic+.

### Forbidden (reject list)
- Stick-figure / googly-eye character cinema
- Ken Burns / zoompan / crossfade storyboard slideshows
- Flat geometric Skia emoji with rays
- Hard letterboxed “movie theater” black bars as the primary look
- Opaque black fullscreen that kills the live feed for the whole clip
- Low particle count, hard-edged sprites, PowerPoint energy

## Per-gift story beats (Blyp P0 heroes)

| Gift | TikTok-class read |
|------|-------------------|
| **Rocket** | Metallic rocket + volumetric exhaust → ascent streak → apex star burst / shockwave |
| **Crown** | Polished gold/jeweled crown descends on light shaft → contact glitter storm → regal halo |
| **Diamond** | Oversized crystal rotates with caustic flashes → prism beams → shatter spark bloom |
| **Cheer burst** | Confetti/ribbon cannon from center → stadium light streaks → gold/teal celebration wash |
| **Fire** | Ember floor → rising luminous flame column → heat bloom + ember rain (energy, not cartoon phoenix face) |

## Composite rules for Blyp (Android reality)

Android does **not** reliably decode true per-pixel alpha in stock ExoPlayer paths. Production options:

1. **Preferred later:** AlphaPlayer-style RGB\|A MP4 + GL recombine (TikTok’s own pattern).
2. **This pass:** Dark-keyed H.264 on near-black plate + **transparent overlay root**, soft vignette, **glow plate**, **screen-style brightening** via additive flash layers, large center scale — so the gift reads as luminous FX over live, not a film reel.

## Honest quality ceiling this sprint

We can jump dramatically past Canvas cartoon rigs with high-end procedural 2D/particle luxury FX on dark key. We **cannot** honestly claim parity with TikTok’s best paid 3D gifts (Universe, Lion Dance, sports cars) without commissioned AE/3D alpha packs. Ship the leap + a motion-designer commission brief.
