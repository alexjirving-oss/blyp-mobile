# Gift Play upload gate

**Verdict: PENDING_USER_REVIEW**  
**Date:** 2026-08-06  
**Worktree:** `C:\Users\Alex\Blyp26-eas-modern`  
**Baseline:** beats `b1822a5` dark-key 2D path with self-authored EEVEE + true alpha

## Decision

**Do not bake / upload to Play yet.** Watch the Desktop reel and reply `PLAY GATE: PASS` (or request another in-house pass).

This is **not** blocked on paid freelancers. Masters are self-authored; gate is visual sign-off only.

## Shipped

| Item | Path |
|------|------|
| Alpha RGB\|A MP4 masters | `assets/gifts/cinema/alpha/{id}.mp4` |
| Alpha WebM (Desktop QC) | `assets/gifts/cinema/alpha/{id}.webm` |
| Dark-key fallback | `assets/gifts/cinema/clips/{id}.mp4` |
| WebGL alpha player | `GiftAlphaFilmPlayer.js` |
| `ALPHA_CLIPS` wired | `filmClipRegistry.js` |
| Blender pipeline | `_agent/gift-animations-20260806/alpha-pipeline/` |

## Honest visual note

Clear leap past Canvas/dark-key 2D: real 3D PBR (HDRI chrome/gold/crystal), transparent film, RGB\|A playback. Rocket + crown read strongest; cheer/fire still denser/warmer in a follow-up pass if you want TikTok-top density. Not claiming Unreal character-gift parity.

## Desktop preview

```
C:\Users\Alex\Desktop\Blyp-Gift-Animations-Copy\previews\film-reel.html
```

## Unblock Play

1. Watch Desktop reel (alpha WebM over live stand-in)
2. Reply `PLAY GATE: PASS`
3. Only then bake / upload
