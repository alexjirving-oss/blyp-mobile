# For You F1 — module design

Canonical: `diagnostics/FOR_YOU_GROUND_UP_DESIGN.md`.

This package (`src/feed/`) is the **only** For You playback path.

- Player: `ForYouVideo` → BlypShorts (`ShortsNative`)
- URL: `resolvePlayableUri` (progressive-first; never lead with dead `startUrl`)
- Window: `ForYouEngine` + `forYouPlayerController` (≤1 active, ≤2 warm, seek-to-0 on promote)
- Audio: `forYouAudio` (FY ownership only; no LIVE session steal)

**Removed from For You path:** storm `FeedPlayer*` / `FeedPooledVideo`, expo-av / `EnhancedVideo` fallback.
**Untouched:** LIVE.
