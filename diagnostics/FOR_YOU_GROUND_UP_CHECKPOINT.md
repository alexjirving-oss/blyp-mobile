# For You ground-up — checkpoint

**When:** 2026-08-11  
**Tree:** `Blyp26-frenemies-ea-v1`  
**Bar:** TikTok-class For You (swipe ~2/sec, play+audio from t=0). LIVE untouched. No bake. No storm Exo-pool patches.

## Verdict (this slice)

**LINKED-READY (code path complete pending bake).**

Registration + ViewManager props + pool seek/warm/first-frame behavior are in tree. Device still shows “For You player not linked” until a native rebuild/AAB includes `ShortsPackage` / `withBlypShortsIOS` sources. No bake in this slice.

## Design

- `diagnostics/FOR_YOU_GROUND_UP_DESIGN.md` — architecture
- `src/feed/DESIGN.md` — package pointer

## Strategy change

Replaced “fix storm pool blockers” with a **clean For You path**: `PremiumFeedVideo` → `ForYouVideo` → BlypShorts only. Storm `FeedPlayer` / `FeedPooledVideo` / expo-av fallback **hard-disabled** on this path.

## Native link completeness (slice 2)

| Check | Status |
|-------|--------|
| Android `MainApplication` registers `shorts.ShortsPackage` (not `FeedPlayerPackage`) | **PASS** |
| Android `ShortsViewManager` name `BlypShortsView`; props `uri` / `playing` / `muted` / `role` / `seekToMs` / `resizeMode` | **PASS** |
| Android `ShortsPool` size 3; seek-0 on activate (muted or not); first-frame reveal; Media3 progressive+HLS; no audio-mode steal | **PASS** |
| iOS `app.config.js` includes `./plugins/withBlypShortsIOS` | **PASS** |
| iOS bridges: `BlypShorts` module + `BlypShortsViewManager`; props include `seekToMs` + `role` | **PASS** |
| iOS `ShortsPool` size 3; seek-0 on activate; warm prepare; **no** `AVAudioSession.setCategory` | **PASS** |
| `ShortsNative.js` resolves `NativeModules.BlypShorts` + `BlypShortsView` when linked | **PASS** (runtime after bake) |
| Warm neighbors paused+muted (`ForYouEngine.playbackFlags`) | **PASS** |
| Progressive-first URL (`resolvePlayableUri`) | **PASS** |

## Files changed / added

| File | Change |
|------|--------|
| `diagnostics/FOR_YOU_GROUND_UP_DESIGN.md` | Ground-up design |
| `diagnostics/FOR_YOU_GROUND_UP_CHECKPOINT.md` | This note (link slice) |
| `src/feed/*` | FY module: ForYouVideo, Engine, controller, audio, ShortsNative, resolvePlayableUri |
| `src/components/Feed/PremiumFeedVideo.js` | Renders `ForYouVideo` only |
| `src/screens/HomeScreen.js` | For You cell: `resolvePlayableUri` + engine flags |
| `android/.../MainApplication.kt` | Registers `ShortsPackage` |
| `android/.../shorts/*` | BlypShorts Media3 pool + ViewManager (`seekToMs`, role, first-frame) |
| `plugins/withBlypShortsIOS.js` | Copies iOS BlypShorts into Xcode project |
| `plugins/blyp-shorts-ios/*` | AVPlayer pool; bridges; `seekToMs`; no AVAudioSession steal |
| `__tests__/forYouGroundUp.test.js` | Link + pool + seekToMs assertions |
| `__tests__/forYouGroundUpPath.test.js` | No storm/expo-av on FY path |
| `__tests__/forYouPlayerController.test.js` | Window / seek-0 promote |
| `__tests__/resolvePlayableUri.test.js` | Progressive-first |

## Storm code status

- **Not patched.** Not used on For You.
- Android `feedplayer/` package absent; For You does not import it.

## Residual (post-bake only)

- Tip bake / Play internal so the AAB actually ships linked BlypShorts (until then hard-fail banner is correct).
- Device proof at ~2 swipes/sec after install (out of scope here).

## Unit tests

```
npx jest __tests__/resolvePlayableUri.test.js \
  __tests__/forYouPlayerController.test.js \
  __tests__/forYouGroundUpPath.test.js \
  __tests__/forYouGroundUp.test.js --no-coverage
```

**Result:** 4 suites, **25 passed**, 0 failed.
