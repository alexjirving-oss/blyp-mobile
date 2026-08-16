# Grid 9 hard-fix — adversarial notes

Date: 2026-08-16  
Repo: `C:\Users\Alex\Blyp26-frenemies-ea-v1`  
Branch tip: `feat/full-tip-package-20260809`

## What we proved (code / API)

1. **LiveKit missing on Cloud Run (cam root cause)**  
   `gcloud run services describe blyp-live-service` env keys include `LIVE_GRID9_ENABLED=1` only.  
   **No `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`.**  
   Token route soft-fails → client status `unavailable`. Prior ship could not light cams on-device regardless of UI.

2. **List zombies are structural, not a one-shot Redis clear**  
   Matches stay in `grid9:active-matches` while phase remains `combat`/`roulette`.  
   Stuck turn loops (or idle Cloud Run) leave “In combat · 9/9 · audience 0 · jackpot ~100” forever.  
   Fix: stricter stale/abandon filters + SREM on every list read + startup `sweepGrid9ActiveMatchIndex` + optional `POST /api/grid9/sweep-active`.  
   `GET /api/grid9/matches` no longer requires Cognito (public summaries) so ops can curl.

3. **Jackpot 1100 → 100 is correct product math**  
   Each new public match seeds `GRID9_HOUSE_SEED_COINS = 100`. Pots do not carry across matches.  
   UI now labels **New match pot** + house-seed copy when pot ≤ seed.

4. **Turn advance stall path**  
   Prior fix (`advanceGrid9Turn(..., Date.now())`) remains; roulette duration raised to **12s** (dramatic selection). Combat starts only after roulette lands (server `roulette_end`).

5. **Roulette drama**  
   Server still picks `selectedSlotIndex` up front; client decelerating highlight lands on that seat over ~12s (`dramaticRouletteHighlightIndex` unit-tested).

## What we did NOT prove on-device

- **Camera publish/subscribe on a physical phone** — blocked until LIVEKIT_* is present on Cloud Run. UI path is implemented (shared room + per-seat tiles) but **cannot claim PASS for cam on-device**.
- Gift cinema / gift send end-to-end economy against production wallet.
- Multi-instance timer race under load (single-flight poll still exists).

## Residual risks

| Risk | Severity | Mitigation needed |
|---|---|---|
| LIVEKIT_* still unset after deploy | P0 for cams | Set secrets via `--update-env-vars` / Secret Manager; verify `GET /api/grid9/livekit-status` → `configured:true` |
| Sentinel-only public matches still create briefly before stale GC | Med | Startup + list sweep; consider not listing until ≥1 human |
| Synthesized VFX coords if measure fails | Low | Soft geometry; may look offset once |
| Roulette 12s feels long if SFX missing | Low | Assets are placeholders |

## Required ops follow-up (Alex / infra)

```text
gcloud run services update blyp-live-service \
  --region=us-central1 --project=blyp-master \
  --update-env-vars LIVE_GRID9_ENABLED=1,LIVEKIT_URL=wss://...,LIVEKIT_API_KEY=...,LIVEKIT_API_SECRET=...
```

Then: `curl https://blyp-live-service-innn3d7yqq-uc.a.run.app/api/grid9/livekit-status`
Expect `{ "configured": true, ... }`.
