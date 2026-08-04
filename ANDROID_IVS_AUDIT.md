# Android IVS Modules Audit

**Audit Date:** December 6, 2025  
**Device/Build:** Dev client from EAS build

---

## 1. Module Names & Registration

### IVSBroadcastModule
- **Class:** `com.blyp.mobile.ivs.IVSBroadcastModule`
- **getName():** Returns `"IVSBroadcastModule"` ✓
- **Extends:** `ReactContextBaseJavaModule`
- **Registration:** Added to `IVSPackage.kt` → MainApplication.kt ✓

### IVSPlayerModule
- **Class:** `com.blyp.mobile.ivs.IVSPlayerModule`
- **getName():** Returns `"IVSPlayerModule"` ✓
- **Extends:** `ReactContextBaseJavaModule`
- **Registration:** Added to `IVSPackage.kt` → MainApplication.kt ✓

---

## 2. IVSBroadcastModule – Method Audit

### Exported @ReactMethod Functions

| JS Call | Kotlin Signature | Parameters | Return Type | Status |
|---------|------------------|------------|-------------|--------|
| `startHostSession(stageArn, token, sessionId, callback)` | `fun startHostSession(stageArn: String, token: String, sessionId: String, callback: Callback)` | 3 strings + callback | callback invoked | ✓ MATCHES |
| `stopHostSession(callback)` | `fun stopHostSession(callback: Callback)` | callback only | callback invoked | ✓ MATCHES |
| `startGuestSession(stageArn, token, sessionId, slotIndex, callback)` | `fun startGuestSession(stageArn: String, token: String, sessionId: String, slotIndex: Int, callback: Callback)` | 3 strings, 1 int + callback | callback invoked | ✓ MATCHES |
| `stopGuestSession(callback)` | `fun stopGuestSession(callback: Callback)` | callback only | callback invoked | ✓ MATCHES |
| `setMicEnabled(enabled, callback)` | `fun setMicEnabled(enabled: Boolean, callback: Callback)` | boolean + callback | callback invoked | ✓ MATCHES |
| `setCameraEnabled(enabled, callback)` | `fun setCameraEnabled(enabled: Boolean, callback: Callback)` | boolean + callback | callback invoked | ✓ MATCHES |
| `switchCamera(callback)` | `fun switchCamera(callback: Callback)` | callback only | callback invoked | ✓ MATCHES |

### Events Emitted
**None currently** (stubs don't emit events; production version should emit):
- `IVS_HOST_LOCAL_JOINED` when broadcast starts
- `IVS_HOST_LOCAL_LEFT` when broadcast stops
- `IVS_REMOTE_PARTICIPANT_JOINED` when guest joins
- `IVS_BROADCAST_ERROR` on error

---

## 3. IVSPlayerModule – Method Audit

### Exported @ReactMethod Functions

| JS Call | Kotlin Signature | Parameters | Return Type | Status |
|---------|------------------|------------|-------------|--------|
| `joinAsViewer(playbackUrl, sessionId, callback)` | `fun joinAsViewer(playbackUrl: String, sessionId: String, callback: Callback)` | 2 strings + callback | callback invoked | ✓ MATCHES |
| `leaveAsViewer(callback)` | `fun leaveAsViewer(callback: Callback)` | callback only | callback invoked | ✓ MATCHES |
| `play(callback)` | `fun play(callback: Callback)` | callback only | callback invoked | ✓ MATCHES |
| `pause(callback)` | `fun pause(callback: Callback)` | callback only | callback invoked | ✓ MATCHES |
| `stop(callback)` | `fun stop(callback: Callback)` | callback only | callback invoked | ✓ MATCHES |

### Events Emitted
**None currently** (stubs don't emit events; production version should emit):
- `IVS_VIEWER_JOINED` when playback starts
- `IVS_PLAYER_STATE_CHANGED` on player state change (buffering, playing, etc.)
- `IVS_PLAYER_ERROR` on error

---

## 4. JS ↔ Kotlin Contract Comparison

### IVSNativeClient.ts → IVSBroadcastModule.kt

#### startHostSession
```typescript
// IVSNativeClient.ts line ~287
return new Promise((resolve, reject) => {
  IVSBroadcastModule.startHostSession(
    params.stageArn,
    params.token,
    params.sessionId,
    (error: any) => {
      if (error) {
        reject(new Error(error.message || 'Failed to start host session'));
      } else {
        resolve();
      }
    }
  );
});
```

```kotlin
// IVSBroadcastModule.kt line ~23–31
fun startHostSession(
    stageArn: String,
    token: String,
    sessionId: String,
    callback: Callback
) {
    callback.invoke(mapOf(
        "message" to "startHostSession not implemented on Android yet",
        "code" to "IVS_NOT_IMPLEMENTED"
    ))
}
```

**Analysis:**
- JS passes 4 args: `stageArn` (string), `token` (string), `sessionId` (string), callback
- Kotlin expects 4 args: `stageArn: String`, `token: String`, `sessionId: String`, `callback: Callback`
- **✓ MATCHES** – parameter types and count correct
- Callback is invoked with error map (JS treats as truthy error)

---

### IVSNativeClient.ts → IVSPlayerModule.kt

#### joinAsViewer
```typescript
// IVSNativeClient.ts line ~398
return new Promise((resolve, reject) => {
  IVSPlayerModule.joinAsViewer(params.playbackUrl, params.sessionId, (error: any) => {
    if (error) {
      reject(new Error(error.message || 'Failed to join as viewer'));
    } else {
      resolve();
    }
  });
});
```

```kotlin
// IVSPlayerModule.kt line ~20–29
fun joinAsViewer(
    playbackUrl: String,
    sessionId: String,
    callback: Callback
) {
    callback.invoke(mapOf(
        "message" to "joinAsViewer not implemented on Android yet",
        "code" to "IVS_NOT_IMPLEMENTED"
    ))
}
```

**Analysis:**
- JS passes 3 args: `playbackUrl`, `sessionId`, callback
- Kotlin expects 3 args: same order
- **✓ MATCHES** – parameter types and count correct

---

## 5. Crash Diagnosis

### Error Message
```
java.lang.RuntimeException: Cannot convert argument of type class ...
  at com.facebook.react.bridge.Arguments.fromJavaArgs(Arguments.java:...)
  at com.facebook.react.cxxbridge.CxxCallbackImpl.invoke(CxxCallbackImpl.java:...)
  at com.blyp.mobile.ivs.IVSBroadcastModule.startHostSession(IVSBroadcastModule.kt:...)
```

### Root Cause Analysis

The crash occurs in `Arguments.fromJavaArgs()` when the Callback is invoked with a `Map<String, Any>`. Here's why:

1. **React Native Bridge Limitation:**
   - The Callback parameter on Android expects to receive only bridge-compatible types
   - Valid types: `String`, `Number`, `Boolean`, `null`, `ReadableMap`, `ReadableArray`
   - **Invalid:** Raw Kotlin `Map<String, Any>` passed directly to callback

2. **Issue in Current Code:**
   ```kotlin
   // This line causes the crash:
   callback.invoke(mapOf(
       "message" to "startHostSession not implemented on Android yet",
       "code" to "IVS_NOT_IMPLEMENTED"
   ))
   ```
   - `mapOf(...)` returns a `Map<String, String>` (Kotlin HashMap)
   - React Native bridge cannot serialize this directly
   - Must use `WritableMap` instead

3. **Correct Approach:**
   ```kotlin
   import com.facebook.react.bridge.WritableMap
   import com.facebook.react.bridge.Arguments
   
   val errorMap: WritableMap = Arguments.createMap()
   errorMap.putString("message", "startHostSession not implemented on Android yet")
   errorMap.putString("code", "IVS_NOT_IMPLEMENTED")
   callback.invoke(errorMap)
   ```

### Why This Matters
- React Native bridge only serializes `WritableMap`, `WritableArray`, primitives, and null
- Raw `Map` or custom objects cannot cross the bridge
- Leads to immediate crash before Kotlin code can even run

---

## 6. Current Stubs vs. Production Implementation

### What Stubs Currently Do
✓ Define correct method signatures  
✓ Extend correct base class  
✓ Are registered correctly  
❌ Return errors instead of working  
❌ Don't use AWS IVS SDK  
❌ Don't capture device media  
❌ Don't emit events  

### What Production Should Do
- Use `BroadcastSession` to capture camera + microphone
- Create `Stage` object to connect to IVS service
- Emit `IVS_HOST_LOCAL_JOINED` event with participant data
- Listen to device/stage events and forward to JS
- Handle errors gracefully
- Same pattern for player with `Player` + playback URL

---

## 7. Summary

| Aspect | Status | Notes |
|--------|--------|-------|
| Module names | ✓ Correct | IVSBroadcastModule, IVSPlayerModule |
| Method signatures | ✓ Match TS | All parameter types and counts correct |
| Bridge types | ❌ **NEEDS FIX** | Current code uses raw `Map`, must use `WritableMap` |
| Event emission | ❌ NOT IMPLEMENTED | Stubs don't emit events |
| AWS IVS SDK | ❌ NOT INTEGRATED | No BroadcastSession or Player usage |
| Crash root cause | ✓ Identified | `Map` passed to callback instead of `WritableMap` |

---

## 8. Fix Priority (Phase 3)

1. **CRITICAL:** Replace `mapOf(...)` with `Arguments.createMap()` in all callback invocations
2. **HIGH:** Implement real AWS IVS SDK integration (BroadcastSession, Player)
3. **HIGH:** Add event emission (via `DeviceEventManagerModule`)
4. **MEDIUM:** Add logging for debugging
5. **LOW:** Add configuration/state validation

