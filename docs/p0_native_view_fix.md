# P0 Fix: IVS Native View Duplicate Registration

## Symptom
- Crash / red screen in dev client:
  - `Invariant Violation: Tried to register two views with the same name IVSBroadcastView`
  - Also seen with `IVSPlayerView`

## Root cause
React Native keeps `ReactNativeViewConfigRegistry` state across Fast Refresh/HMR, but module-level JS variables are reset.
If `requireNativeComponent('IVS…View')` is invoked again after a refresh/reload, RN attempts to register the same view name again and throws.

In Blyp, IVS views are obtained via `getNativeIVS*View()` and can be touched during streaming screen renders and HMR updates.

## Fix
- Cache the `requireNativeComponent()` result on `globalThis` so it survives Fast Refresh / JS reload.
- Ensure each `IVS*View` is required at most once per app process.

## Change
- Updated: src/live/ivs/native/views.ts

## Verification
Expected: no further occurrences of:
- `Tried to register two views with the same name IVSBroadcastView`
- `Tried to register two views with the same name IVSPlayerView`
