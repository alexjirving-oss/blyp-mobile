# Streaming Architecture – State of Play

**Audit Date:** December 6, 2025  
**Status:** IVS backend selected, but Android native stubs return `IVS_NOT_IMPLEMENTED`. HLS fallback available.

---

## 1. Backend Selection & Configuration

### Active Backend
- **Primary:** `EXPO_PUBLIC_STREAMING_BACKEND=ivs` (set in `.env`)
- **Factory:** `src/streaming/StreamingBackendFactory.ts`
- **Config Read:** From Expo extras at app boot

### Backend Options
1. **HLS** (working, production-ready):
   - Uses Firebase + custom HLS service
   - Located in `HLSStreamingBackend.ts` and `src/services/HLSLiveStreamService.*`
   - Fallback if IVS unavailable

2. **IVS** (primary, partially implemented):
   - Broadcast: Backend API ready, native stubs return errors
   - Viewer: Backend API ready, native stubs return errors
   - Real AWS IVS SDK not yet integrated into Android

### Dev Bypass
- **Flag:** `EXPO_PUBLIC_IVS_DEV_BYPASS=1` (enabled in `.env`)
- **Behavior:** When enabled + dev build, generates mock tokens locally instead of calling backend
- **Location:** `src/api/ivsLiveApi.ts` lines 150–240
- **Security:** Disabled in production builds automatically

### API Base URL
- **Flag:** `EXPO_PUBLIC_API_BASE_URL` (commented out in `.env`)
- **Current:** Dev bypass is active, so backend URL not used
- **For Real Backend:** Set to LAN IP or production URL

---

## 2. IVS API Layer (`src/api/ivsLiveApi.ts`)

### Endpoints & Responses

#### Host Start: `ivsHostStart(params?: IVSHostStartParams)`
- **Real Call:** `POST /api/ivs/host-start`
- **Dev Bypass:** Returns mock `IvsHostStartResponse` with fake token
- **Response Fields:**
  ```typescript
  {
    ok: boolean;
    role: 'host';
    userId: string;
    streamId: string;
    stageArn: string;
    region: string;
    token: string;        // JWT for native broadcast
    expiresAt: number;    // Unix seconds
  }
  ```

#### Guest Join: `ivsGuestJoin(params: IVSGuestJoinParams)`
- **Real Call:** `POST /api/ivs/guest-join`
- **Dev Bypass:** Returns mock `IvsGuestJoinResponse`
- **Response:** Same shape as host (role='guest')

#### Viewer Join: `ivsViewerJoin(params: IVSViewerJoinParams)`
- **Real Call:** `POST /api/ivs/viewer-join`
- **Dev Bypass:** Returns mock `IvsViewerJoinResponse`
- **Response:**
  ```typescript
  {
    ok: boolean;
    role: 'viewer';
    userId: string;
    streamId: string;
    playbackUrl: string;  // HLS/IVS playback URL
  }
  ```

### Error Handling
- Network errors → throws descriptive message
- Non-200 HTTP → throws with status code
- Missing Cognito token → throws "not logged in"
- Invalid JSON → throws parsing error

---

## 3. Host Flow (Current State)

### Step-by-Step: Press "Go Live"

1. **UI Component:** `LiveStreamScreen.tsx` (or Go Live button)
   - Calls hook: `useIVSHostSession({ enabled: true })`

2. **Hook:** `src/live/ivs/hooks/useIVSHostSession.ts` (line ~60: `startStreaming()`)
   - Calls: `ivsHostStart({ devLabel: title })`
   - **Location:** `src/api/ivsLiveApi.ts` ~ line 350–380
   
3. **API Layer Decision:**
   - If `DEV_BYPASS_ENABLED`: returns mock token locally
   - Else: calls real backend with Cognito auth
   
4. **Hook Receives Token:**
   - Updates state: `setStreamId(response.streamId)`
   - Creates `HostSessionParams` object:
     ```typescript
     {
       stageArn: response.stageArn,
       token: response.token,
       sessionId: response.streamId
     }
     ```

5. **Call Native:** `client.startHostSession(hostParams)`
   - Client: `IVSNativeClient.ts` (line ~277)
   - **Calls Kotlin Method:** `NativeModules.IVSBroadcastModule.startHostSession(...)`
   - **Current Status:** ❌ **STUB RETURNS ERROR**
     ```javascript
     // IVSBroadcastModule.kt line ~23–31
     callback.invoke(mapOf(
       "message" to "startHostSession not implemented on Android yet",
       "code" to "IVS_NOT_IMPLEMENTED"
     ))
     ```

6. **Expected Flow (Once Native Implemented):**
   - Kotlin receives token, creates BroadcastSession
   - Emits event: `IVS_HOST_LOCAL_JOINED`
   - Hook receives event, updates state: `setConnectionState('connected')`
   - UI shows live countdown

### Where HLS Still Appears
- **Fallback only:** If backend is HLS (not IVS)
- **Not mixed:** IVS flow doesn't call HLS services

---

## 4. Viewer Flow (Current State)

### Step-by-Step: Join Viewer Stream

1. **UI Component:** `LiveStreamViewer.tsx`
   - Calls hook: `useIVSViewerSession({ streamId, enabled: true })`

2. **Hook:** `src/live/ivs/hooks/useIVSViewerSession.ts` (line ~47: `joinStream()`)
   - Calls: `ivsViewerJoin({ streamId })`
   
3. **API Layer:**
   - If dev bypass: returns mock playback URL
   - Else: calls backend `/api/ivs/viewer-join`
   
4. **Hook Receives Playback URL:**
   - Creates `ViewerSessionParams`:
     ```typescript
     {
       playbackUrl: response.playbackUrl,
       sessionId: response.streamId
     }
     ```

5. **Call Native:** `client.joinAsViewer(viewerParams)`
   - Client: `IVSNativeClient.ts` (line ~376)
   - **Calls Kotlin Method:** `NativeModules.IVSPlayerModule.joinAsViewer(...)`
   - **Current Status:** ❌ **STUB RETURNS ERROR**
     ```kotlin
     // IVSPlayerModule.kt line ~20–29
     callback.invoke(mapOf(
       "message" to "joinAsViewer not implemented on Android yet",
       "code" to "IVS_NOT_IMPLEMENTED"
     ))
     ```

### Guest Flow
- Same pattern as host, but:
  - Calls `ivsGuestJoin()` instead of `ivsHostStart()`
  - Uses `startGuestSession()` instead of `startHostSession()`
  - Includes `slotIndex` parameter for UI layout

---

## 5. Android Native Modules (Stubs)

### IVSBroadcastModule.kt
- **Status:** Stub, 83 lines
- **Method Signatures:**
  - `startHostSession(stageArn, token, sessionId, callback)`
  - `stopHostSession(callback)`
  - `startGuestSession(stageArn, token, sessionId, slotIndex, callback)`
  - `stopGuestSession(callback)`
  - `setMicEnabled(enabled, callback)`
  - `setCameraEnabled(enabled, callback)`
  - `switchCamera(callback)`

### IVSPlayerModule.kt
- **Status:** Stub, 57 lines
- **Method Signatures:**
  - `joinAsViewer(playbackUrl, sessionId, callback)`
  - `leaveAsViewer(callback)`
  - `play(callback)`
  - `pause(callback)`
  - `stop(callback)`

### Problem: Current Crash
- **Error:** `java.lang.RuntimeException: Cannot convert argument of type class ...`
- **Root Cause:** (See Phase 2 diagnosis below)

---

## 6. Current Issues

### Issue #1: Native Bridge Contract Mismatch
- **JS Side:** `IVSNativeClient.ts` calls:
  ```typescript
  IVSBroadcastModule.startHostSession(
    params.stageArn,
    params.token,
    params.sessionId,
    (error: any) => { ... }
  )
  ```
- **Kotlin Side:** `IVSBroadcastModule.kt` expects:
  ```kotlin
  fun startHostSession(
    stageArn: String,
    token: String,
    sessionId: String,
    callback: Callback
  )
  ```
- **Status:** ✓ Signatures match (for stubs)
- **But:** Stubs return errors instead of working

### Issue #2: No Real AWS IVS Implementation
- No BroadcastSession, Player, or Stage SDK usage
- No device capture (camera/mic)
- No event emission to JS

### Issue #3: Backend Selection Not Dynamic
- Only reads at startup
- Cannot switch IVS ↔ HLS without app restart

---

## 7. How to Switch Backends (For Testing)

1. **HLS Mode:**
   ```bash
   # In .env
   EXPO_PUBLIC_STREAMING_BACKEND=hls
   # Restart dev server
   ```

2. **IVS Mode (Dev Bypass):**
   ```bash
   # Already set in .env
   EXPO_PUBLIC_STREAMING_BACKEND=ivs
   EXPO_PUBLIC_IVS_DEV_BYPASS=1
   ```

3. **IVS Mode (Real Backend):**
   ```bash
   # In .env
   EXPO_PUBLIC_STREAMING_BACKEND=ivs
   EXPO_PUBLIC_IVS_DEV_BYPASS=0
   EXPO_PUBLIC_API_BASE_URL=http://192.168.1.236:3001
   # Make sure backend server is running
   ```

---

## 8. Next Steps (Phase 2–3)

1. **Replace Android Stubs with Real AWS IVS SDK**
   - Add `implementation 'software.amazon.ivs:broadcast:...'`
   - Add `implementation 'software.amazon.ivs:player:...'`
   - Implement BroadcastSession wrapper

2. **Fix JS↔Native Bridge**
   - Ensure all method signatures use bridge-safe types
   - Use `ReadableMap` for complex objects
   - Use `Promise` for async methods

3. **Wire Events**
   - Emit all events from native to JS
   - JS listens and updates state

4. **Test End-to-End**
   - Host: Go Live → camera/mic captured → events emitted
   - Viewer: Join → playback starts → quality metrics emitted

---

## Summary

- ✓ Backend selection works (IVS chosen)
- ✓ API layer ready (real + dev bypass)
- ✓ TS hooks ready (useIVSHostSession, useIVSViewerSession)
- ❌ Android native modules are stubs (return IVS_NOT_IMPLEMENTED)
- ❌ No real AWS IVS SDK integrated yet
- ✓ HLS fallback available if needed
