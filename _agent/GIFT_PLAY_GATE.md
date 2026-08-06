# Gift Play upload gate

**Verdict: PENDING_USER_REVIEW**  
**Date:** 2026-08-06  
**Worktree:** `C:\Users\Alex\Blyp26-eas-modern`  
**Baseline:** densified cheer_burst + warmer fire alpha masters (post-`eb32a27`)

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

## Latest densify pass

- `cheer_burst`: denser multi-color confetti + stadium streaks + keyed spark layers
- `fire`: warmer orange/red column, dense ember field, rising sparks (replaces pale-cream wash)
- rocket / crown / diamond unchanged this pass
- Same RGB\|A side-by-side alpha encode pipeline

## Honest visual note

Clear leap past Canvas/dark-key 2D. Rocket + crown still the strongest heroes; cheer/fire now denser/warmer than `eb32a27`. Not claiming Unreal character-gift parity.

## Desktop preview

```
C:\Users\Alex\Desktop\Blyp-Gift-Animations-Copy\previews\film-reel.html
```

## Unblock Play

1. Watch Desktop reel (alpha WebM over live stand-in)
2. Reply `PLAY GATE: PASS`
3. Only then bake / upload
