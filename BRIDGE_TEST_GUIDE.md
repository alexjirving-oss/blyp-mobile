# IVS Bridge Test - Integration Guide

## What This Is
A diagnostic tool to verify if the JS→Native bridge is working. This isolates whether the connection failure is:
1. **Bridge layer issue** (JS can't talk to native)
2. **startHostSession logic** (native method exists but fails)
3. **Parameter marshaling** (types not converting correctly)

## Files Created
- `src/streaming/IVSBridgeTest.ts` - Core bridge test logic
- `src/screens/BridgeTestScreen.tsx` - UI component for testing

## Quick Setup

### Step 1: Add Route to App.js
```typescript
import { BridgeTestScreen } from './src/screens/BridgeTestScreen';

// In your Stack.Navigator or appropriate navigation:
<Stack.Screen 
  name="BridgeTest" 
  component={BridgeTestScreen}
/>
```

### Step 2: Navigate to the Screen
From your live stream screen or home, navigate to BridgeTest:
```typescript
navigation.navigate('BridgeTest');
```

Or temporarily replace the home screen for quick testing.

### Step 3: Run the Test
1. Open the BridgeTestScreen
2. Press "▶ Run Bridge Test" button
3. The test will:
   - Check if IVSBroadcastModule exists
   - Call `testBridge()` (a dummy method that logs)
   - Call `startHostSession()` with test parameters
   - Wait for callbacks with 5-second timeout

### Step 4: Check Results

**In Metro Console** (this screen will show):
```
[BRIDGE_TEST] ✅ IVSBroadcastModule found
[BRIDGE_TEST] testBridge callback fired!
[BRIDGE_TEST] ✅ testBridge result: Bridge works!
...
```

**In Android Logcat** (separate terminal):
```bash
adb logcat IVS_NATIVE:D *:S
```

You should see:
```
12-08 13:XX:XX.XXX D/IVS_NATIVE: [NATIVE] addListener called for event: ...
12-08 13:XX:XX.XXX D/IVS_NATIVE: [NATIVE] **TEST BRIDGE METHOD CALLED**
12-08 13:XX:XX.XXX D/IVS_NATIVE: [NATIVE] startHostSession called: ...
```

## Expected Outcomes

### ✅ SUCCESS (Bridge Works)
Metro logs show all callback fires, Logcat shows IVS_NATIVE logs.
→ Problem is in startHostSession logic, not the bridge.

### ❌ FAILURE 1: testBridge timeout
"testBridge callback never fired"
→ Bridge layer broken, JS can't invoke native methods at all.

### ❌ FAILURE 2: startHostSession timeout
"startHostSession callback never fired" but testBridge worked
→ Issue specific to startHostSession method.

### ❌ FAILURE 3: Exception
"Exception calling testBridge" or "Exception calling startHostSession"
→ Parameter type mismatch or method signature wrong.

## What the Native Code Does

### testBridge() [NEW]
```kotlin
@ReactMethod
fun testBridge(callback: Callback) {
    Log.d(IVS_TAG, "[NATIVE] **TEST BRIDGE METHOD CALLED**")
    callback.invoke(null, "Bridge works!")
}
```
Pure bridge test - no complex logic.

### startHostSession() [INSTRUMENTED]
```kotlin
@ReactMethod
fun startHostSession(stageArn: String, token: String, sessionId: String, callback: Callback) {
    Log.d(IVS_TAG, "[NATIVE] startHostSession called: ...")
    mainHandler.post {
        try {
            startSession(...)
            callback.invoke()
        } catch (e: Exception) {
            Log.e(IVS_TAG, "[NATIVE] startSession failed: ...", e)
            callback.invoke(errorMap(...))
        }
    }
}
```

## Common Issues & Fixes

### Issue: "IVSBroadcastModule not found"
**Cause:** Native module not properly registered
**Fix:** Verify IVSPackage is in MainApplication.kt getPackages()

### Issue: testBridge works but startHostSession times out
**Cause:** Issue in startSession() logic
**Fix:** Check the startSession() method, likely an infinite loop or exception

### Issue: Both timeout
**Cause:** Bridge layer completely broken
**Fix:** Check React Native version compatibility, rebuild with `npx expo run:android --clean`

### Issue: Exception thrown
**Cause:** Callback signature mismatch
**Fix:** Ensure callback uses single-argument (error) or two-argument (error, result) pattern

## Cleanup After Testing

Remove the BridgeTest route from App.js when done:
```typescript
// Remove this:
import { BridgeTestScreen } from './src/screens/BridgeTestScreen';
// And delete the Stack.Screen definition
```

The test files will remain in place but unused.

## Next Steps After Diagnosis

### If Bridge Works ✅
Problem is in `startSession()` implementation. Look for:
- Infinite loops
- Uncaught exceptions
- Failed BroadcastSession creation
- Missing listeners

### If Bridge Fails ❌
Rebuild with:
```bash
npx expo run:android --clean
# Or full clean:
cd android && ./gradlew clean && cd ..
npx expo run:android
```

Check for compile errors in IVSBroadcastModule.kt
