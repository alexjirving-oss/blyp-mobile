# LIVE STABILITY P1

**Branch:** `fix/live-stability-p1`  
**Commit:** `af7565c`  
**Goal:** Deterministic Go Live flow — one press = one session; no auth flaps breaking start; viewer discovery reliable.

---

## Changes (Minimal Diff)

### Client-Side Guards & Correlation

**File:** `src/screens/LiveStreamScreen.js`

1. **Double-start guard:** `startInFlightRef` and `countdownInProgressRef` prevent re-entrancy from manual press or AUTO_START.
2. **AUTO_START safety:** AUTO_START will not trigger if either guard is active.
3. **Logging hygiene:** `[LIVE][RENDER]` used in render; true mount-only log added via `useEffect([])` as `[LIVE][COMPONENT_MOUNT]`.
4. **Auth stability gate:** Before countdown and before actual start, require `authReady && isAuthenticated && uid` to be stable for 500ms. If auth flips during countdown, cancel with user alert.
5. **Correlation id:** Generate `goLiveAttemptId` at button press; attached to all major logs and included in backend payloads.

### API Client Propagation

**File:** `src/api/ivsLiveApi.ts`

- Add `[LIVE_API][REQ]` log with `{ path, attemptId, url }`
- Propagate `X-GoLive-Attempt-Id` header via `callLiveBackend()`
- Accept optional `attemptId` parameter in `startHostLive(title, attemptId?)`

**File:** `src/live/ivs/hooks/useIVSHostSession.ts`

- Thread `attemptId` through `startStreaming(cameraPosition?, attemptId?)` to `startHostLive()`

### Backend Identity & Correlation

**File:** `backend/blyp-live-service/src/routes/liveRoutes.ts`

- Read header `x-golive-attempt-id` (case-insensitive)
- Log receipt: `[API][/api/live/start] attemptId=<id> user=<sub>`
- Echo `attemptId` in response (top-level): `{ attemptId, session, hostToken }`
- Use Cognito `sub` (fallback `username`) for `userId` consistently

**File:** `backend/blyp-live-service/src/live/liveService.ts`

- Ensure `session.hostUserId` equals Cognito identity
- IVS `CreateParticipantToken.userId` equals same identity

---

## Identity Alignment (Critical for P1)

**Client:** Uses Cognito `uid` (typically `sub` from token)

**Backend:** Derives stable user identity from Cognito token:
- Prefer `req.user.sub` (most stable, UUID-like)
- Fallback to `req.user.username` if `sub` missing

**Consistency:**
- `session.hostUserId` = derived identity
- IVS `CreateParticipantToken.userId` = derived identity
- Firestore stream document `userId` = derived identity (if applicable in write path)

This ensures viewer join tokens and participant matching work correctly.

---

## Constraints & Fallback

- If auth flips during debounce or countdown, start is canceled with an alert; user must retry.
- If backend does not accept `X-GoLive-Attempt-Id`, it is ignored server-side; logs still contain the id for client-side correlation.
- If viewer discovery still fails after identity alignment, check:
  - Firestore write path/collection mismatch
  - Viewer join token path

---

## Verification (Copy/Paste After ONE Go Live Press)

### Commands

Run after starting Metro + backend and performing ONE Go Live press:

```powershell
# Capture relevant logs
npx --yes rg -n "X-GoLive-Attempt-Id|\[LIVE_API\]\[REQ\]|\[API\]\[/api/live/start\]|attemptId|hostUserId|sub|Token retrieved" audit\logs\metro.log audit\logs\backend_dev.log -S | Select-Object -Last 200

# Or with grep if available
rg "X-GoLive-Attempt-Id|\[LIVE_API\]\[REQ\]|\[API\]\[/api/live/start\]|attemptId|hostUserId" audit/logs/*.log -n
```

### Expected Metro Log Sequence

```
[LIVE][START_STREAMING_PRESSED] Button press detected! {...}
[LIVE][ATTEMPT_ID] { goLiveAttemptId: "1734058123456-a1b2c3d4" }
[LIVE][START_COUNTDOWN] Countdown starting now! { goLiveAttemptId: "1734058123456-a1b2c3d4" }
[LIVE][COUNTDOWN_TICK] 3 { goLiveAttemptId: "1734058123456-a1b2c3d4" }
[LIVE][COUNTDOWN_TICK] 2 { goLiveAttemptId: "1734058123456-a1b2c3d4" }
[LIVE][COUNTDOWN_TICK] 1 { goLiveAttemptId: "1734058123456-a1b2c3d4" }
[LIVE][COUNTDOWN_COMPLETE] Countdown done, calling actuallyStartStream { goLiveAttemptId: "1734058123456-a1b2c3d4" }
[LIVE][ACTUALLY_START_STREAM] Function called {..., goLiveAttemptId: "1734058123456-a1b2c3d4"}
[IVS_API][HEALTH_CHECK] { url: "http://192.168.1.236:4000/health" }
[IVS_API][HEALTH_CHECK_RESULT] { status: 200, healthy: true }
[LIVE_API][START_HOST_LIVE] { title: "...", attemptId: "1734058123456-a1b2c3d4" }
[LIVE_API][REQ] { path: "/api/live/start", attemptId: "1734058123456-a1b2c3d4", url: "..." }
[LIVE_API][/api/live/start] POST to http://192.168.1.236:4000/api/live/start
[LIVE_API][/api/live/start] Response status: 200
[LIVE_API][/api/live/start] Response: {"attemptId":"1734058123456-a1b2c3d4","session":{...},"hostToken":"..."}
```

### Expected Backend Log Sequence

```
[API][/api/live/start] { attemptId: "1734058123456-a1b2c3d4", user: "blyp" }
[IVS][CREATE_STAGE] Using name: blyp-dev-...
```

### Proof Checklist

- [ ] One Go Live press produces exactly one `/api/live/start`
- [ ] Preflight health check succeeds (status: 200)
- [ ] Request includes `attemptId` in `[LIVE_API][REQ]` log
- [ ] Header `X-GoLive-Attempt-Id` sent (visible in backend if logged)
- [ ] Backend logs print: `[API][/api/live/start] { attemptId: "...", user: "..." }`
- [ ] Response echoes same `attemptId` (visible in client response log)
- [ ] `session.hostUserId` equals Cognito identity (check backend logs or response)
- [ ] No second countdown fires while first is in flight
- [ ] If auth flips during countdown, countdown cancels with alert

### Success Criteria

If all above checks pass and `attemptId` matches across client and backend logs, **you're in TikTok-grade correctness territory** ✅

---

## Files Changed

- `src/screens/LiveStreamScreen.js`
- `src/api/ivsLiveApi.ts`
- `src/live/ivs/hooks/useIVSHostSession.ts`
- `backend/blyp-live-service/src/routes/liveRoutes.ts`
- `backend/blyp-live-service/src/live/liveService.ts`
- `fix/LIVE_STABILITY_P1.md`

---

## Next Steps

1. Start backend: `cd backend/blyp-live-service && npm run dev`
2. Start Metro: `npx expo start --dev-client --clear --lan`
3. Perform ONE Go Live press
4. Run verification command above
5. Check that `attemptId` matches and `hostUserId` equals your Cognito `sub`
