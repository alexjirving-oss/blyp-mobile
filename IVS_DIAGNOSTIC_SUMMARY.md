# IVS Host Connection Failure - Diagnostic Summary

**Issue:** IVS host session state machine stuck in "connecting" state indefinitely.

**Diagnosis Date:** December 8, 2025

---

## Root Cause Identified ✅

### The JS→Native Bridge Call is Not Reaching Native Code

**Evidence Chain:**
1. ✅ **JS code IS executing** → `[IVS_API][HOST_START]` appears in Metro logs
2. ✅ **NativeModules is initialized** → `[IVS_NATIVE][CONFIG]` fires at app startup
3. ❌ **Native method NEVER invoked** → Zero IVS_NATIVE logs in logcat (with instrumentation added)
4. ❌ **Native callback never fires** → JS callback times out waiting for response

**Conclusion:** When `NativeModules.IVSBroadcastModule.startHostSession()` is called from TypeScript, the native Kotlin method is never entered.

---

## What We Know

### Working ✅
- IVSBroadcastModule is properly registered in IVSPackage
- Module is accessible (can destructure from NativeModules)
- Event emitter initialization works
- Metro console logging works
- Android build succeeds
- App runs on Galaxy Z Fold 7 (RFCY71ZFS6F)

### NOT Working ❌
- `startHostSession()` native method invocation
- Callback never fires (neither error nor success)
- No exception thrown (silent failure)
- No native logs appear (even after instrumentation)

---

## Instrumentation Added

### Native (IVSBroadcastModule.kt)
Added comprehensive logging at:
- **Line 69**: `startHostSession()` entry point
- **Line 71-72**: Parameter logging (stageArn, tokenLength, sessionId)
- **Line 189**: `startSession()` entry
- **Line 191**: When BroadcastSession created
- **Line 192**: When `session.start()` called
- **Line 198-204**: State change callbacks (CONNECTED, DISCONNECTED)
- **Line 206-210**: Error callbacks
- **Line 304**: Emit helper (logs every event sent to JS)
- **Line 306**: New `testBridge()` dummy method for isolation testing

### Test Infrastructure
- **IVSBridgeTest.ts**: Standalone bridge test with timeouts
- **BridgeTestScreen.tsx**: Interactive UI to run tests
- **BRIDGE_TEST_GUIDE.md**: Step-by-step testing instructions

---

## Most Likely Root Causes

### 1. **Method Signature Mismatch** (Most Likely)
The React Native bridge may be unable to match the Kotlin method signature:
```kotlin
fun startHostSession(
    stageArn: String,
    token: String,
    sessionId: String,
    callback: Callback
) : Unit
```

**Why:** Callback pattern might not be correctly marshaled. React Native has specific requirements for native method signatures.

### 2. **Silent Exception in Bridge Layer**
An exception occurs during method lookup/invocation but is silently caught.

**Why:** JS code shows no try-catch errors, yet callback never fires.

### 3. **Module Registration Issue**
Even though module exists, the method isn't properly exported to React Native.

**Why:** This would explain why `testBridge()` might work but `startHostSession()` doesn't.

### 4. **Type Coercion Failure**
String parameters don't marshal correctly from JS to Kotlin.

**Why:** Complex strings (URLs, tokens) could fail conversion in edge cases.

---

## How to Diagnose Next

### Step 1: Test the Bridge (5 minutes)
```bash
# In project root:
1. Add BridgeTestScreen.tsx to App.js routes
2. Navigate to BridgeTest screen in the app
3. Press "▶ Run Bridge Test"
4. Check Metro console for [BRIDGE_TEST] logs
5. Check logcat: adb logcat IVS_NATIVE:D *:S
```

### Expected Results:
```
✅ If testBridge() works: Bridge layer is OK, problem is in startHostSession()
❌ If testBridge() times out: Bridge layer is broken
⚠️  If startHostSession() works: Problem was fixed by instrumentation rebuild
```

### Step 2: If Bridge Fails
```bash
# Full clean rebuild
cd android && ./gradlew clean && cd ..
npx expo run:android --clean
```

### Step 3: If Bridge Works But startHostSession Fails
Debug `startSession()` logic:
- Check if BroadcastSession creation throws exception
- Verify BroadcastSession listeners are attached
- Check if mainHandler.post() is executing
- Verify callback.invoke() is being called

---

## Files Modified

### Native (Android)
- `android/app/src/main/java/com/blyp/mobile/ivs/IVSBroadcastModule.kt`
  - Added `Log` import
  - Added `IVS_TAG` constant
  - Added `testBridge()` method
  - Added 15+ `Log.d()` calls throughout

### TypeScript
- NEW: `src/streaming/IVSBridgeTest.ts` (91 lines)
- NEW: `src/screens/BridgeTestScreen.tsx` (215 lines)
- NEW: `BRIDGE_TEST_GUIDE.md` (documentation)
- NEW: `IVS_DIAGNOSTIC_SUMMARY.md` (this file)

---

## Quick Reference: Logcat Commands

```bash
# All IVS native logs
adb logcat IVS_NATIVE:D *:S

# IVS + React Native JS logs
adb logcat IVS_NATIVE:D ReactNativeJS:D *:S

# Full logcat (verbose)
adb logcat -v time

# Filter for specific test
adb logcat -v time | grep -i "BRIDGE_TEST\|IVS_NATIVE"

# Save to file
adb logcat -v time IVS_NATIVE:D > logcat_ivs_native.log &

# Clear before test
adb logcat -c
```

---

## Quick Reference: Metro Logs

Look for these patterns in Metro console:
```
[BRIDGE_TEST] - Diagnostic test logs
[IVS_NATIVE][CONFIG] - Module initialization
[IVS_API][HOST_START] - JS calling host start
[IVS_CLIENT] - JS client logs
```

---

## Recovery Steps If Something Breaks

### If Build Fails
```bash
npm install
npx expo run:android --clean
```

### If Bridge Test Not Visible
Add this to App.js:
```typescript
import { BridgeTestScreen } from './src/screens/BridgeTestScreen';

// In Stack.Navigator:
<Stack.Screen name="BridgeTest" component={BridgeTestScreen} />
```

### If logcat Shows No IVS_NATIVE Logs
```bash
# Verify module was rebuilt:
npx expo run:android --clean

# Force rebuild of native module:
cd android && ./gradlew clean
cd ..
npx expo run:android
```

---

## Success Criteria

Once fixed:
- [ ] Metro shows `[BRIDGE_TEST] ✅ SUCCESS: Bridge is working!`
- [ ] Logcat shows IVS_NATIVE logs with timestamps
- [ ] `testBridge()` callback fires within 2 seconds
- [ ] `startHostSession()` callback fires (either error or success)
- [ ] Live stream host session transitions to "connected"
- [ ] Video stream begins uploading to IVS

---

## Next Immediate Action

**RUN THE BRIDGE TEST:**
1. Rebuild app (already done: `npx expo run:android`)
2. Add BridgeTestScreen to App.js
3. Navigate to test screen
4. Press "Run Bridge Test"
5. Report results

This will definitively answer: **Is the bridge broken, or is it the startHostSession logic?**
