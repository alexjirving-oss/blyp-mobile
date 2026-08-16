# Grid 9 hard-fix — adversarial notes

Date: 2026-08-16  
Repo: `C:\Users\Alex\Blyp26-frenemies-ea-v1`  
Branch tip: `feat/full-tip-package-20260809`

## What we proved (code / API)

1. **LiveKit on Cloud Run (cam root cause — ops unblocked on 00228)**  
   Earlier tip (`00227-pbl`) had `LIVE_GRID9_ENABLED=1` only → token soft-fail → client `unavailable`.  
   **Now (rev `blyp-live-service-00228-jfz`):** `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` present;  
   `GET /api/grid9/livekit-status` → `configured:true` (`urlHost` set). On-device cam PASS still requires a phone retest.

2. **List zombies are structural, not a one-shot Redis clear**  
   Matches stay in `grid9:active-matches` while phase remains `combat`/`roulette`.  
   Stuck turn loops (or idle Cloud Run) leave “In combat · 9/9 · audience 0 · jackpot ~100” forever.  
   Fix: stricter stale/abandon filters + SREM on every list read + startup `sweepGrid9ActiveMatchIndex` + optional `POST /api/grid9/sweep-active`.  
   `GET /api/grid9/matches` is Cognito-free **in grid9Routes**, but must be mounted **before** `economyRoutes` / `liveRoutes` (those use `router.use(cognitoJwtMiddleware)` and 401 every `/api/*` first).  
   Remount shipped in tip `index.ts`; verify with unauthenticated curl after deploy (expect JSON `ok/count/matches`, not 401).

**Curl proof (rev `blyp-live-service-00227-pbl`, pre-LiveKit secrets):**
- `GET /api/grid9/matches?limit=20` → HTTP 200 `{"ok":true,"matches":[],"count":0}`
- `GET /api/grid9/livekit-status` → HTTP 200 `{"ok":true,"configured":false,"urlHost":null}`

**Curl proof (rev `blyp-live-service-00228-jfz`, 2026-08-16):**
- `GET /health` → HTTP 200 `ok/ready`, db+redis ok
- `GET /api/grid9/livekit-status` → HTTP 200 `{"ok":true,"configured":true,"urlHost":"blyp-gzqarrw1.livekit.cloud"}`
- `GET /api/grid9/matches?limit=20` → HTTP 200 `{"ok":true,"matches":[],"count":0}`
- `POST /api/grid9/livekit-token` (no auth) → HTTP 401 (route mounted; Cognito required — expected)

3. **Jackpot 1100 → 100 is correct product math**  
   Each new public match seeds `GRID9_HOUSE_SEED_COINS = 100`. Pots do not carry across matches.  
   UI now labels **New match pot** + house-seed copy when pot ≤ seed.

4. **Turn advance stall path**  
   Prior fix (`advanceGrid9Turn(..., Date.now())`) remains; roulette duration raised to **12s** (dramatic selection). Combat starts only after roulette lands (server `roulette_end`).

5. **Roulette drama**  
   Server still picks `selectedSlotIndex` up front; client decelerating highlight lands on that seat over ~12s (`dramaticRouletteHighlightIndex` unit-tested).

## What we did NOT prove on-device

- **Camera publish/subscribe on a physical phone** — server LiveKit is configured; UI path is implemented (shared room + per-seat tiles). **Still cannot claim PASS until Alex retests on device against tip client + 00228.**
- Gift cinema / gift send end-to-end economy against production wallet.
- Multi-instance timer race under load (single-flight poll still exists).

## Residual risks

| Risk | Severity | Mitigation needed |
|---|---|---|
| LIVEKIT_* unset | ~~P0~~ **cleared on 00228** | Re-check only if `livekit-status` regresses to `configured:false` |
| Old Redis matches with prior rules literals | P0 for turn loop — **code shipped** | `migrateGrid9GameStateInput` rewrites rules to current constants on parse (proved: timer was failing on `rouletteDurationMs: 3500` vs `12000`) |
| On-device cam / publish not yet retested | P0 for ship claim | Alex: Play/internal build with dramatic roulette + LiveKit room; join combatant seat; confirm local + remote tiles |
| Sentinel-only public matches still create briefly before stale GC | Med | Startup + list sweep; consider not listing until ≥1 human |
| Synthesized VFX coords if measure fails | Low | Soft geometry; may look offset once |
| Roulette 12s feels long if SFX missing | Low | Assets are placeholders |

## Dramatic Roulette ship (code complete)

| Field | Value |
|---|---|
| Duration | **12s** server `GRID9_ROULETTE_DURATION_MS` + client `GRID9_ROULETTE_FLASH_MS` |
| Server | Picks `selectedSlotIndex` up front; combat after `roulette_end` |
| Client | Decelerating highlight → lands on selected seat (`dramaticRouletteHighlightIndex`, unit-tested) |
| Client VN/VC | **1.0.103 / 2026327179** (ledger + gradle) |
| Hard-fix commits | `a0fe0360` drama+cams layout+list GC; `343c7576` public mount+rules migrate; `7a7fe6de` curl proof notes |
| Live-service | Tip URL ready; LiveKit secrets live on **00228-jfz** |

## Ops follow-up

**LiveKit secrets: done** (00228). No further env update needed unless status regresses.

**Adversarial zombie: CLOSED (2026-08-16)** — tip healthy, LiveKit configured on Cloud Run, list GC shipped. No further agent investigation; remaining work is device retest only.

**Alex next (one move):** device retest cams + 12s roulette on a build that includes `a0fe0360`+ (VN 1.0.103 / VC 2026327179 or newer tip bake).
