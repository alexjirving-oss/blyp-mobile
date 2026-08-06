# Play Console Android recommendations (Blyp 1.0.18+)

Honest status of Google Play Console “Improve your app” items for large screens,
edge-to-edge deprecations, and R8.

## Fixed in app / release config

| Item | Change |
|------|--------|
| MainActivity `screenOrientation=portrait` | `fullSensor` + `resizeableActivity=true` + `smallestScreenSize` in configChanges (`AndroidManifest` + `plugins/withPlayConsoleAndroidFixes.js`) |
| Expo `orientation: portrait` | `default` in `app.config.js` so prebuild does not re-lock MainActivity |
| Camera / live video portrait | JS lock via `expo-screen-orientation` only while focused (`src/utils/lockPortraitWhileFocused.js`) |
| ML Kit barcode UI portrait | Manifest merge override for `GmsBarcodeScanningDelegateActivity` → `fullSensor` |
| Deprecated StatusBar color in our JS | Removed `StatusBar.setBackgroundColor` / `setTranslucent` from `App.js`; `ScreenContainer` no longer passes Android `backgroundColor`; app config drops `androidStatusBar.backgroundColor` |
| Modern edge-to-edge native | `MainActivity.enableEdgeToEdge`, `edgeToEdgeEnabled=true`, transparent system bar theme colors |
| R8 / minify / shrink | Release defaults **on** in `android/app/build.gradle` + expanded `proguard-rules.pro` |

## Residual dependency noise (cannot fully clear in-app)

These still call deprecated Android 15 edge-to-edge window APIs. Clearing them
requires upstream releases; upgrading within Expo SDK 54 helps but does not
eliminate stack frames from RN / screens / Material.

| Package (installed) | Deprecated surface | Notes / versions needed |
|---------------------|--------------------|-------------------------|
| `react-native` **0.81.5** | `StatusBarModule` → `window.statusBarColor`; `WindowUtil` → `LAYOUT_IN_DISPLAY_CUTOUT_MODE_*` | Track RN / Expo SDK that no-ops these on API 35+ (Expo PR #43276 style cleanup lands in later SDK patches) |
| `react-native-screens` **~4.16.0** | `ScreenWindowTraits` status/nav bar color setters | Need screens release that stops writing `statusBarColor` / `navigationBarColor` under edge-to-edge |
| `expo-status-bar` / `expo-navigation-bar` | Legacy color / translucent props | Prefer style/visibility only; color APIs are no-ops / deprecated on Android 15+ |
| Material / AppCompat (transitive) | Theme `statusBarColor` / `navigationBarColor` attrs | Theme items set transparent; library code may still touch deprecated setters at runtime |
| `expo-camera` → `play-services-code-scanner` | Shipped portrait activity | Overridden in our manifest; residual until Google ships orientation-flexible scanner UI |

**BLOCKED for 100% silence:** stay on Expo SDK 54 / RN 0.81 until Expo ships the
full edge-to-edge API no-op cleanup and `react-native-screens` drops window color
writes. Safe in-SDK bump: keep `npx expo install --fix` within SDK 54.

## Verify after bake

- Merged manifest: MainActivity `fullSensor`, ML Kit activity override present.
- Release mapping / R8: `minifyEnabled true` on `release` build type.
- Fold7: unfold does not force portrait chrome; Camera + Live still lock portrait while focused.

## Bake / upload note (2026-08-06)

Allocated `versionCode` **2026313370** for these fixes. Local canonical bake did **not** finish in this session (Windows Gradle/`createBundleReleaseJsAndAssets` Metro hangs / process kills under long release builds; one attempt reached `minifyReleaseWithR8` then failed on a dirty AGP graph). Fixes are committed; re-run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\release\RUN_PRE_RELEASE_REGRESSION_GATE.ps1 -ExpectedVersionCode 2026313370
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\release\BUILD_RELEASE_CANDIDATE.ps1 -ExpectedVersionCode 2026313370
npm run play:upload -- -Profile production
```

If `2026313370` is already in `tools/release/built_versioncodes.txt`, bump first with `tools/release/bump_version_code.ps1`.
