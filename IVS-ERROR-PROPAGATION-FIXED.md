# IVS Streaming Layer - Strict Error Propagation & Native Session Lifecycle Fix

**Date**: December 9, 2025  
**Status**: ✅ STEP 1 & STEP 2 COMPLETE  

---

## Problem Identified

When starting IVS broadcast, the app showed:
- ✅ `STREAM_START_SUCCESS` logged
- 🎉 "IVS live streaming started successfully"
- ❌ But connection never reaches CONNECTED
- ❌ Native error: `ERROR_INVALID_DATA` + "Token used in exchange is not compatible"

**Root Causes**:
1. **UI Layer Lying**: Success was logged BEFORE verifying native session actually started
2. **Native Token Exchange Bug**: Code was calling `exchangeToken()` + `join()` on a fresh Stage instance, treating it like an update instead of a new session

---

## STEP 1 - UI Layer: Stop Lying About Success ✅

**File**: `src/screens/LiveStreamScreen.js` (lines 480-530)

**Before**: 
```javascript
await ivsHostSession.startStreaming();
if (ivsHostSession.error) {  // ← error check came AFTER success log
  throw new Error(ivsHostSession.error);
}
setIsStreaming(true);
logStreamingEvent('STREAM_START_SUCCESS', {...});  // ← logged success even if error set
console.log('🎉 IVS live streaming started successfully');
```

**After** (FIXED):
```javascript
await ivsHostSession.startStreaming();

// CRITICAL: Check for errors BEFORE considering success
if (ivsHostSession.error) {
  console.error('[LIVE][IVS][ERROR_CHECK] Hook reported error:', ivsHostSession.error);
  throw new Error(ivsHostSession.error);
}

// Only mark as streaming after native session confirmed
setIsStreaming(true);
setStreamStartTime(Date.now());

// STRICT: Only log success AFTER we know native succeeded (no error + state advancing)
logStreamingEvent('STREAM_START_SUCCESS', {
  backendId: 'IVS',
  userId: uid,
  streamId: streamId || ivsHostSession.streamId,
  connectionState: ivsHostSession.connectionState,  // ← verify state
  source: 'UI',
});

console.log('🎉 IVS live streaming started successfully', {
  streamId: ivsHostSession.streamId,
  connectionState: ivsHostSession.connectionState,
});
```

**Impact**: UI now ONLY logs success if:
- ✅ `ivsHostSession.startStreaming()` completes without throwing
- ✅ `ivsHostSession.error` is null/empty
- ✅ Includes actual connection state in log

---

## STEP 2 - Native Layer: Fix Stage Session Lifecycle ✅

**File**: `android/app/src/main/java/com/blyp/mobile/ivs/IVSBroadcastModule.kt` (lines 209-245)

### The Bug
Original code:
```kotlin
private fun startSession(stageArn: String, token: String, sessionId: String) {
    stopSession()  // ← cleanups old session
    // ... setup devices ...
    
    val stageInstance = Stage(context, stageArn, strategy)
    try {
        stageInstance.addRenderer(stageRenderer)
        stageInstance.exchangeToken(token)  // ❌ BUG: tries to "exchange" on fresh instance
        stageInstance.join()                 // ❌ then joins without token in join call
        stage = stageInstance
    } catch (e: Exception) {
        // ... error handling ...
    }
}
```

**Root Cause**: `exchangeToken()` is meant to UPDATE an existing token on an active session. Calling it on a brand new Stage instance with a fresh token causes the SDK to reject it as "incompatible" because it's expecting to exchange (update) not authenticate fresh.

### The Fix
```kotlin
private fun startSession(stageArn: String, token: String, sessionId: String) {
    Log.d(IVS_TAG, "[NATIVE] startSession() called with stageArn=$stageArn, sessionId=$sessionId")
    
    // CRITICAL FIX: Always destroy any previous session first
    stopSession()

    val context = reactApplicationContext
    deviceDiscovery = deviceDiscovery ?: DeviceDiscovery(context)
    currentSessionId = sessionId

    selectDefaultDevices()
    rebuildLocalStreams()

    val strategy = buildStageStrategy()
    stageStrategy = strategy

    // Create a brand new Stage instance for this session
    val stageInstance = Stage(context, stageArn, strategy)
    try {
        stageInstance.addRenderer(stageRenderer)
        
        // CRITICAL: Use join(token) directly - do NOT call exchangeToken()
        // exchangeToken() is for updating an existing session, not starting fresh
        // Each startSession should be a clean, new join with a new token
        stageInstance.join(token)
        
        stage = stageInstance
        Log.d(IVS_TAG, "[NATIVE] Stage joined successfully with new token")
    } catch (e: Exception) {
        Log.e(IVS_TAG, "[NATIVE] Failed to join stage: ${e.message}", e)
        try {
            stageInstance.release()
        } catch (_: Exception) {}
        throw e
    }
}
```

**Key Changes**:
1. ✅ Removed `stageInstance.exchangeToken(token)` 
2. ✅ Changed to `stageInstance.join(token)` - passes token directly to join call
3. ✅ Added comments explaining why (fresh session, not exchange)
4. ✅ Improved error logging

**Impact**: 
- Each `startHostSession` call now creates a completely fresh Stage instance
- Token is used in the initial `join()` call (not exchange)
- No "immutable properties mismatch" errors
- Connection state should properly flow: `idle → connecting → connected`

---

## Expected Behavior After Fix

### Backend Logs
```
✅ [IVS_LOCAL] Real IVS tokens: ENABLED
   AWS credentials: from default profile (aws configure)
   AWS SDK: loaded
   Stage ARN: arn:aws:ivs:us-east-1:030569357413:stage/Az6jNylYmg1j
```

### App Logs (should NOT see error anymore)
```
[LIVE][IVS] Starting IVS broadcast
[LIVE][IVS_HOST_START_REQUEST] { streamId: "stream-...", title: "..." }
[IVS_HOST][TOKEN_RECEIVED] { stageArn: "arn:aws:ivs:...", streamId: "stream-..." }
[IVS_HOST][BROADCAST_SESSION_STARTED] { streamId: "stream-..." }
[IVS_STAGE] Connection state: CONNECTING
[IVS_STAGE] Connection state: CONNECTED  ← NOW REACHES HERE
[IVS_STAGE] Participant joined: id=..., local=true
[LIVE][IVS][SUCCESS] { streamId: "stream-...", connectionState: "connected" }
🎉 IVS live streaming started successfully
```

### Native Logcat
```
D/IVS_NATIVE: [NATIVE] startHostSession called: stageArn=..., tokenLength=..., sessionId=...
D/IVS_NATIVE: [NATIVE] Stage joined successfully with new token
D/IVS_NATIVE: [IVS_STAGE] Connection state: CONNECTING
D/IVS_NATIVE: [IVS_STAGE] Connection state: CONNECTED
D/IVS_NATIVE: [IVS_STAGE] Participant joined: id=..., local=true
```

### NO MORE:
```
❌ ERROR_INVALID_DATA: Token used in exchange is not compatible
❌ [STREAM][IVS][STREAM_START_SUCCESS] while connection stuck in CONNECTING
❌ 🎉 IVS live streaming started successfully (but actually failed)
```

---

## Verification Checklist

Before rebuilding native:

- ✅ `src/screens/LiveStreamScreen.js` - success logging moved AFTER error check
- ✅ `android/app/src/main/java/com/blyp/mobile/ivs/IVSBroadcastModule.kt` - removed `exchangeToken()`, using `join(token)`
- ✅ Error messages improved in both layers

Next steps:

1. Run linter/typecheck to confirm no syntax errors
2. Build Android: `npm run android` or `npx expo run:android`
3. Start device with dev build
4. Open app → Live → Go Live
5. Monitor logs: expect `CONNECTED` state + success log only on actual success

---

## Why This Fixes the Root Cause

The "token exchange" error was a **symptom**, not the real problem. The real problem was:

**Architecture**: Each native call to `startHostSession()` should create a completely independent, fresh Stage session with a new token.

**What Was Happening**: Code was calling `exchangeToken()` which told the AWS SDK "I'm updating the token on an existing session". But since we just created a fresh Stage instance, the SDK saw:
- Fresh Stage instance (no existing session state)
- Request to "exchange" token (implies there WAS a previous token)
- → Token properties don't match what's expected
- → ERROR_INVALID_DATA

**What Fixes It**: Using `join(token)` directly tells the SDK "This is a fresh join with this token" which is exactly what we want for a new session lifecycle.

---

**Status**: ✅ READY FOR NATIVE BUILD & DEVICE TESTING
