# IVS Implementation Audit (current state)

## 1) High-level summary
- JS/TS layer is wired to prefer IVS (`streamingConfig.backend` defaults to `ivs` via `src/config/StreamingBackend.ts`), but the older factory `src/streaming/StreamingBackendFactory.ts` still defaults to HLS unless `EXPO_PUBLIC_STREAMING_BACKEND=ivs`. Mixed selection logic risks confusion.
- Live screen (`src/screens/LiveStreamScreen.js`) enables IVS hooks when `streamingConfig.backend === StreamingBackend.IVS`; otherwise it falls back to the existing HLS camera/segment pipeline.
- Host/viewer hooks (`src/live/ivs/hooks/useIVSHostSession.ts`, `useIVSViewerSession.ts`) call backend APIs (`ivsHostStart`, `ivsViewerJoin`) to fetch tokens/playback URLs, then drive `LiveStreamingClient` via `getIVSNativeClient()`.
- `IVSNativeClient` (`src/streaming/IVSNativeClient.ts`) is the only production client; it requires native modules. On iOS it throws immediately (not supported). On Android it requires `IVSBroadcastModule`/`IVSPlayerModule`; if missing it throws with a hint to use a dev client.
- Legacy `IVSClient` (`src/live/ivs/IVSClient.ts`) remains for tests only; it does not drive native code.

## 2) Native module status
- Android modules exist but are stubs only:
  - `android/app/src/main/java/com/blyp/mobile/ivs/IVSBroadcastModule.kt`: every method returns `IVS_NOT_IMPLEMENTED` errors.
  - `android/app/src/main/java/com/blyp/mobile/ivs/IVSPlayerModule.kt`: similar stub for viewer.
  - `IVSPackage.kt` simply registers the two modules; no view managers.
- Gradle already includes AWS IVS SDKs (broadcast + player) in `android/app/build.gradle`, but the stubs do not call into them; no event emitters are wired, and no view/lifecycle handling exists.
- iOS: no IVS source files found; `IVSNativeClient` explicitly throws on iOS, so IVS cannot run there.
- TypeScript bridge in `src/live/ivs/native/index.ts` expects `NativeModules.IVSBroadcast`/`IVSPlayer`, while `IVSNativeClient` uses `IVSBroadcastModule`/`IVSPlayerModule`. Naming mismatch means these stubs are unused today; the live path is `IVSNativeClient`.

## 3) JS/TS flow integrity
- Hosting flow: `useIVSHostSession` -> `ivsHostStart` (token, stageArn, streamId) -> `LiveStreamingClient.startHostSession` (native) -> event subscriptions update participants/network quality.
- Viewer flow: `useIVSViewerSession` -> `ivsViewerJoin` (playbackUrl, streamId) -> `LiveStreamingClient.joinAsViewer` -> network quality listener. Auto-joins when enabled.
- Guest flow: Interface exists in `LiveStreamingClient`/`IVSNativeClient`, but no hook/UI path currently instantiates guest sessions; backend API for guest tokens not referenced in hooks.
- Error handling: `IVSNativeClient` will throw at construction on unsupported platforms or missing modules, which will crash any code path that constructs it without guards. Live screen currently calls hooks when `backend===IVS`, so on iOS or Expo Go this will fail.
- Backend selection: `StreamingFeatureConfig` default IVS contrasts with `StreamingBackendFactory` default HLS. HLS camera pipeline is still fully wired in `LiveStreamScreen` as a fallback, but IVS selection is not currently feature-flagged per platform.

## 4) Test coverage / health
- `npm test` (Jest) passes: 18 suites, 83 tests, 0 failures. Relevant IVS test: `src/live/ivs/__tests__/IVSClient.test.ts` exercises only the legacy JS client, not the native path.
- Console noise during tests comes from media description service (Gemini) and IVSClient init logs; no failing assertions. No automated coverage for `IVSNativeClient`, hooks, or native bridge.

## 5) Gaps preventing production IVS
- Native implementation missing: Android modules are stubs; no IVS SDK calls, no event emitters, no surfaces for video.
- iOS absent: zero IVS native code; `IVSNativeClient` hard-throws.
- Module naming split: `IVSNativeClient` expects `IVSBroadcastModule`/`IVSPlayerModule`; `src/live/ivs/native/index.ts` expects `IVSBroadcast`/`IVSPlayer`. Need a single contract and consistent naming between native and JS.
- No guest-path UI or hook, despite interface support.
- No platform guard in `LiveStreamScreen` to avoid constructing `IVSNativeClient` on unsupported platforms (will crash in Expo Go/iOS).
- Dev client requirement: `IVSNativeClient` requires a custom build; no documentation wired into runtime to steer users away from Expo Go.

## 6) Action plan (recommended order)
1) **Align selection + guards**: unify backend selection to a single source (prefer `StreamingFeatureConfig`), add platform checks so IVS paths are skipped on iOS/Expo Go with a user-facing fallback to HLS.
2) **Android native MVP**: replace stubs in `IVSBroadcastModule.kt`/`IVSPlayerModule.kt` with real IVS SDK calls, plus event emitters matching `IVSNativeClient` expectations (`IVS_*` events). Add basic view handling and lifecycle cleanup.
3) **JS/native contract**: pick module names (`IVSBroadcastModule`/`IVSPlayerModule` or `IVSBroadcast`/`IVSPlayer`) and update `IVSNativeClient` + TS stubs to match; add TypeScript interfaces for emitted events.
4) **iOS parity**: implement Swift modules (broadcast + player) or gate IVS off on iOS until ready. Mirror Android event surface.
5) **Guest join path**: add a guest hook + UI path using `startGuestSession` and wire to backend token endpoint.
6) **Testing**: add integration tests/mocks for `IVSNativeClient` behavior and hook state transitions; add E2E smoke on Android dev client to validate native modules load.
7) **Docs + tooling**: document EAS dev client steps (IVS requires native build), add runtime warning when running in Expo Go, and ensure `EXPO_PUBLIC_STREAMING_BACKEND` usage is consistent.

## 7) Immediate risks
- Running IVS on iOS or Expo Go will throw at hook construction.
- Selecting IVS in prod without native implementation will surface `IVS_NOT_IMPLEMENTED` errors from Android stubs, blocking streaming.
- Mixed backend defaults can surprise deploys (config file says IVS default, factory falls back to HLS).
