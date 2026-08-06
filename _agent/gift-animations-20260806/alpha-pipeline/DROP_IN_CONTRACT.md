# Alpha gift drop-in contract

Ready for commissioned / purchased masters. Player already prefers this path when modules are registered.

## Folder layout

```
assets/gifts/cinema/alpha/
  rocket.mp4
  crown.mp4
  diamond.mp4
  cheer_burst.mp4
  fire.mp4
  manifest.json
  (optional QC) rocket.webm … fire.webm   # VP9 yuva for Desktop reel
```

## MP4 technical spec (Android / RN)

| Field | Value |
|-------|--------|
| Layout | **Side-by-side** — **RGB left \| Alpha right** (YYEVA / AlphaPlayer) |
| Subject resolution | 720×1280 portrait (file = **1440×1280**) — or 1080×1920 → **2160×1920** |
| Alpha encoding | Grayscale RGB (R≈G≈B); white = opaque, black = transparent |
| Codec | H.264 `yuv420p`, AAC optional (app plays muted FX bed separately) |
| FPS | 30 |
| Duration | 2.8–4.0s, play once |
| CRF | ~16–20 |

Encode from RGBA PNG / ProRes 4444 / VP9 alpha:

```powershell
python _agent/gift-animations-20260806/alpha-pipeline/encode_alpha_mp4.py --gift all
```

(Expects `_frames/{id}/frame_####.png` RGBA sequences.)

## `manifest.json` schema

```json
{
  "version": 1,
  "layout": "splitHorizontalRgbLeftAlphaRight",
  "gifts": {
    "rocket": {
      "id": "rocket",
      "durationMs": 3400,
      "impactAt": 0.28,
      "gloryMs": 1000,
      "alphaMp4": "assets/gifts/cinema/alpha/rocket.mp4",
      "webm": "assets/gifts/cinema/alpha/rocket.webm"
    }
  }
}
```

## App wiring (after files land)

In `src/components/live/giftMotion/filmClipRegistry.js`, uncomment:

```js
export const ALPHA_CLIPS = {
  rocket: require('../../../../assets/gifts/cinema/alpha/rocket.mp4'),
  crown: require('../../../../assets/gifts/cinema/alpha/crown.mp4'),
  diamond: require('../../../../assets/gifts/cinema/alpha/diamond.mp4'),
  cheer_burst: require('../../../../assets/gifts/cinema/alpha/cheer_burst.mp4'),
  fire: require('../../../../assets/gifts/cinema/alpha/fire.mp4'),
};
```

`GiftCinematicPlayer` already routes: **alpha → dark-key → Skia**.

## Do not drop

- Opaque letterboxed cinema as the only master
- Dark-key-only H.264 pretending to be alpha
- Cartoon Canvas / simple prop stills
- Generative AI watermarked stock without redistributable license
