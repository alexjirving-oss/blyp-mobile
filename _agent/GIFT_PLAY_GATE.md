# Gift Play upload gate

**Verdict: SHIPPED_FOR_LAUNCH**  
**Date:** 2026-08-06  
**Worktree:** `C:\Users\Alex\Blyp26-eas-modern`  
**Baseline:** densified cheer_burst + warmer fire alpha masters (`869aef8` / `eb32a27`)

## Decision

**User override for same-day launch:** bake and upload to Play **now**. Gift visual perfection deferred to a post-launch follow-up pass. Do not re-block Play on Desktop reel sign-off.

## Shipped in this launch bake

| Item | Path |
|------|------|
| Alpha RGB\|A MP4 masters | `assets/gifts/cinema/alpha/{id}.mp4` |
| Alpha WebM (Desktop QC) | `assets/gifts/cinema/alpha/{id}.webm` |
| Dark-key fallback | `assets/gifts/cinema/clips/{id}.mp4` |
| WebGL alpha player | `GiftAlphaFilmPlayer.js` |
| `ALPHA_CLIPS` wired | `filmClipRegistry.js` |
| Blender pipeline | `_agent/gift-animations-20260806/alpha-pipeline/` |

## Honest visual note

Clear leap past Canvas/dark-key 2D. Rocket + crown still the strongest heroes; cheer/fire denser/warmer than `eb32a27`. Not claiming Unreal character-gift parity — polish queue remains open after launch.

## Follow-up (post-launch)

1. Optional Desktop reel QC at `C:\Users\Alex\Desktop\Blyp-Gift-Animations-Copy\previews\film-reel.html`
2. Further densify / hero parity pass if Alex wants another in-house iteration
3. Do **not** hold production promotion on gift polish
