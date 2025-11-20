# Technical Debt — Gesture Handler & Safe Area

Status: temporary mitigation to unblock Android builds under Expo SDK 54 / RN 0.81.

- react-native-gesture-handler (RNGH):
  - Native module excluded from Android autolinking via `react-native.config.js`.
  - Metro alias points `react-native-gesture-handler` to `src/runtime/rngh-shim.js` (safe no-op wrappers) to prevent runtime crashes where RNGH is imported.
  - A patch file exists under `patches/react-native-gesture-handler+2.20.0.patch` but is currently redundant because native autolink is disabled. Keep for reference.

- react-native-safe-area-context:
  - Android patched to remove codegen-only paths and legacy UIManager usage.
  - Patch captured in `patches/react-native-safe-area-context+4.14.1.patch`.

Why: Native RNGH and safe-area-context paths were incompatible with RN 0.81/AGP/Kotlin set used by Expo SDK 54, causing build failures. Priority per MegaCommand: Security & Stability over features.

Risks:
- Navigation gestures may be reduced (no native gesture performance). Basic navigation still works.
- Libraries expecting full RNGH surface may behave differently; our shim provides common exports but is not feature complete.

Removal criteria:
1) Upgrade stack (Expo SDK/RN/AGP/Kotlin) to a set verified compatible with RNGH ≥2.20 and safe-area-context.
2) Remove RNGH alias from `metro.config.js` and re-enable autolinking by deleting `react-native.config.js` entry.
3) Remove local shim `src/runtime/rngh-shim.js` and verify no runtime errors.
4) Reassess if safe-area-context upstream version now builds without our patch; drop `patches/react-native-safe-area-context+*.patch` if so.

Validation checklist when re-enabling RNGH:
- `./android/gradlew assembleDebug` succeeds locally and in CI.
- App boots on device; stack and tab navigators function with gestures.
- No RedBox complaining about missing native modules or RNGH events.
- Run smoke flows: Home feed scroll, open/close screens, camera open, media viewer, chat list.
