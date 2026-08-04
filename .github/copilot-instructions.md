# Blyp (Blyp26) — Copilot Instructions

## Big picture
- Repo has no ios/ directory → do not add iOS guidance or iOS changes.
- **Mobile app:** Expo + React Native (entry: `../App.js`). IVS requires **Dev Client** (not Expo Go). See `../src/streaming/IVSNativeClient.ts`.
- **Default local API (non-IVS):** **Firebase Functions emulator** (base URL via `EXPO_PUBLIC_API_BASE_URL`, code uses `../src/api/ivsLiveApi.ts`).
- **Authoritative for IVS flows:** Express service **`backend/blyp-live-service`** (port **4000**) for create/join session, tokens, stage/participant orchestration, and server-side enforcement. Entry: `../backend/blyp-live-service/src/index.ts`.

## Ops Enforcement Bridge (Mandatory Pre-Work)
- `docs/ops` is the repo-controlled operating memory for critical operator work.
- Before meaningful repo work, read in this exact order:
	1. `docs/ops/HANDOVER_BLYP.md`
	2. `docs/ops/PLAYBOOK.md`
	3. `docs/ops/PROTECTED_FILES.md`
	4. `docs/ops/CURRENT_STATE.md`
	5. `docs/ops/ACTIVE_PROBLEMS.md`
	6. `docs/ops/GOLDEN_BASELINES.md`
	7. `docs/ops/VERIFICATION_MATRIX.md`
	8. `docs/ops/PROOF_PATHS.md`
	9. `docs/ops/CHANGELOG_AGENT.md`
- Stale chat/session assumptions must not outrank repo memory.
- Protected operational assets must not be casually edited (`diagnostics`, rails/megarail/autopilot, release/build/signing, install/verify, recovery tooling, golden code).
- Do not claim fixes without proof.
- If proof path status is `Missing` or `Contradictory`, do not claim a fix and do not improvise certainty.
- Missing proof infrastructure must be recorded explicitly, not hidden.
- Broad regex sweeps and blind global edits are forbidden for critical work.
- After meaningful actions, keep these files current: `docs/ops/CURRENT_STATE.md`, `docs/ops/ACTIVE_PROBLEMS.md`, `docs/ops/GOLDEN_BASELINES.md`, `docs/ops/CHANGELOG_AGENT.md`.

## Non-negotiable boot order (do not “tidy”)
- `App.js` has a **startup prelude** that must remain ordered (auth cleanup / config first).
- Preserve the early initialization pattern (`../src/config/preAuthCleanup.js`, `../src/config/amplify.js`, Firebase config in `../src/config/firebase.js`).

## IVS native views (crash-prone)
- Native view managers live under `../android/app/src/main/java/com/blyp/mobile/ivs/`:
	- `IVSBroadcastViewManager`, `IVSPlayerViewManager`, `IVSRealTimeViewManager` (each `getName()` must be unique).
- **Only one JS registration point:** `../src/live/ivs/native/views.ts` (centralizes `requireNativeComponent`).
- If you see **“Tried to register two views with the same name”**:
	- Check for **manual + autolink** double inclusion.
	- `PackageList.java` currently does **not** include IVS; IVS is manually wired in `../android/app/src/main/java/com/blyp/mobile/MainApplication.kt`. Ensure it’s added **once**.

## Local dev workflow (Windows)
- **Start Metro always (canonical):**
	- `npm run dev-client -- --clear`
	- Fallback: `npm start -- --clear`
- **Start Functions emulator (default API):**
	- `cd functions; npm install; npm run serve`
- **Start `blyp-live-service` only when testing IVS flows (or if configured to hit `:4000`):**
	- `cd backend/blyp-live-service; npm install; npm run dev`

## API routing policy
- Keep Functions as the default base URL; treat `blyp-live-service` as the source of truth for IVS endpoints.
- App chooses by `EXPO_PUBLIC_API_BASE_URL`:
	- Functions (default): `EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:5001/<project>/<region>`
	- IVS mode: `EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:4000` (or a dedicated `EXPO_PUBLIC_IVS_API_BASE_URL` later)

## “App won’t load” recovery (device)
- If device can’t load bundle:
	- `adb reverse tcp:8081 tcp:8081`
	- In RN Dev Menu: set **Debug server host** to `localhost:8081` if it was changed.
- For local APIs on device via reverse (common ports): `5001` (Functions), `4000` (Express).

## Quality gates used in this repo
- `npm run lint`
- `npm run typecheck`

## Scripts you can rely on
- Full bring-up + log capture: `../scripts/start_everything_for_testing.ps1`
- Status helper: `../check-status.ps1`
