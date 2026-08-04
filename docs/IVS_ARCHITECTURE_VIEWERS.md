# IVS Architecture: Hosts, Guests, and Viewers

**Date:** December 10, 2025  
**Status:** Production Implementation (Viewers via HLS/Player)

## Architecture Overview

The Blyp mobile app uses Amazon IVS Real-Time for hosts and guests, but a different playback path for viewers to achieve production-grade reliability and performance.

### Host Path: IVS Real-Time Stage Publishing

- **Use case:** Host goes live, broadcasts video/audio to a stage.
- **Components:**
  - JS Hook: `useIVSHostSession` (in `src/live/ivs/hooks/useIVSHostSession.ts`)
  - Native Module: `IVSBroadcastModule.startHostSession()` (Android Kotlin)
  - SDK: Amazon IVS Broadcast SDK (publishes camera/mic)
- **Why:** Low-latency, real-time publishing. Host needs full control of broadcast settings.
- **Status:** ✅ Implemented and working

### Guest Path: IVS Real-Time Stage Co-Broadcasting (Future)

- **Use case:** Secondary creator joins host's stage (multi-guest, co-streaming).
- **Components:**
  - JS Hook: `useIVSGuestSession` (TODO: not yet implemented)
  - Native Module: `IVSBroadcastModule.startGuestSession()` (Android Kotlin, currently aliases host)
  - SDK: Amazon IVS Broadcast SDK (guest also publishes)
- **Why:** Peers collaborate in real-time; both publish to same stage.
- **Status:** ⚠️ Stubbed (uses host logic today; proper multi-guest logic TBD)

### Viewer Path: IVS Player (HLS / Low-Latency Playback) — **PRODUCTION IMPLEMENTATION**

- **Use case:** User watches a live stream. Simple, reliable video playback.
- **Components:**
  - API: `ivsViewerJoin()` returns `playbackUrl` (from backend)
  - JS Hook: `useIVSViewerSession` (calls `joinAsViewerPlayback`)
  - JS Client: `IVSNativeClient.joinAsViewerPlayback()` (calls player module)
  - Native Module: `IVSPlayerModule.joinAsViewer(playbackUrl, ...)` (Android Kotlin)
  - Native View: `IVSPlayerView` (wraps Amazon IVS Player SDK)
  - SDK: Amazon IVS Player SDK (playback-only, HLS/low-latency protocols)
- **Why:**
  - Viewers don't need publishing APIs.
  - Player SDK is optimized for playback, lighter weight than Broadcast SDK.
  - HLS standard format, proven, reliable.
  - Decouples viewer load from host/broadcast complexity.
  - Easier to scale: many viewers per one host stream.
- **Status:** ✅ Implemented (December 10, 2025)

## Why Not Stage-Based Viewing?

Early architecture considered having viewers join IVS Real-Time stage as read-only subscribers. This approach:
- ✗ Requires participant list UI rendering (layout engine).
- ✗ More complex native code (SurfaceView/TextureView binding per participant).
- ✗ No production-grade viewer rendering component in this repo.
- ✗ Overkill for simple "watch the broadcast" UX.

**Solution:** Use IVS Player (HLS) for viewers. Same stream, but via standard playback protocol. Simpler, proven, production-ready.

## Data Flow Diagrams

### Host: Go Live
```
LiveStreamScreen (host mode)
  → useIVSHostSession.startStreaming()
    → ivsHostStart() [API]
      → Backend: POST /api/ivs/host-start
        ← { stageArn, token, streamId, region }
    → IVSNativeClient.startHostSession(stageArn, token, ...)
      → IVSBroadcastModule.startHostSession(...) [Native]
        → BroadcastSession → Stage → publishes camera/mic
```

### Viewer: Join & Watch (PLAYBACK)
```
LiveStreamScreen (viewer mode, route params: streamId)
  → useIVSViewerSession.joinStream()
    → ivsViewerJoin({ streamId }) [API]
      → Backend: POST /api/ivs/viewer-join
        ← { playbackUrl, stageArn, token, streamId }
    → IVSNativeClient.joinAsViewerPlayback(playbackUrl, sessionId)
      → IVSPlayerModule.joinAsViewer(playbackUrl, sessionId) [Native]
        → Player → loads playbackUrl (HLS stream)
          → IVSPlayerView renders video
```

## Testing Paths

1. **Host device (Android):**
   - Launch app → go to Live Screen → press "Go Live"
   - Should see camera preview
   - No errors in Metro/logcat

2. **Viewer device (Android):**
   - Launch app → tap to join the host's stream (via streamId)
   - Should see:
     - Metro log: `[IVS_VIEWER][JOIN_STREAM]` followed by `[PLAYER_VIEWER] joinAsViewer playbackUrl=...`
     - Native logcat: `[PLAYER_VIEWER] joinAsViewer playbackUrl=...`
     - **Video displayed on screen (no black screen)**

## Production Readiness

- ✅ Android viewer playback: Implemented
- ⚠️ iOS viewer path: Currently uses legacy HLS fallback (not IVS Player SDK)
- ⚠️ Multi-guest layout: Future phase
- ⚠️ Network quality adaptation: Backend can adjust bitrate; UI TBD

---

**Document maintained by:** BLYP-LIVE-IMPLEMENTER  
**Last updated:** December 10, 2025
