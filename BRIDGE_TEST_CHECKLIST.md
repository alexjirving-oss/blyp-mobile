# IVS Diagnosis Checklist & Next Steps

## ✅ Completed: Instrumentation Phase

- [x] Added `Log` import to IVSBroadcastModule.kt
- [x] Added `IVS_TAG = "IVS_NATIVE"` constant
- [x] Instrumented `startHostSession()` entry point
- [x] Instrumented `startSession()` full method
- [x] Instrumented BroadcastSession listener callbacks
- [x] Instrumented `emit()` helper
- [x] Added `testBridge()` dummy method
- [x] Rebuilt app with `npx expo run:android`

## ✅ Completed: Test Infrastructure

- [x] Created IVSBridgeTest.ts with timeout handling
- [x] Created BridgeTestScreen.tsx with UI
- [x] Created BRIDGE_TEST_GUIDE.md documentation
- [x] Created IVS_DIAGNOSTIC_SUMMARY.md
- [x] Created BRIDGE_TEST_INTEGRATION_EXAMPLE.txt

## 🔄 Now Ready: Testing Phase

### Immediate Next Actions (Do These Now)

- [ ] **Step 1**: Open App.js or main navigation file
- [ ] **Step 2**: Import BridgeTestScreen:
  ```typescript
  import { BridgeTestScreen } from './src/screens/BridgeTestScreen';
  ```
- [ ] **Step 3**: Add route to Stack navigator:
  ```typescript
  <Stack.Screen name="BridgeTest" component={BridgeTestScreen} />
  ```
- [ ] **Step 4**: Make sure app is still running (npx expo start --dev-client)
- [ ] **Step 5**: Navigate to BridgeTest screen on device
- [ ] **Step 6**: Press "▶ Run Bridge Test" button
- [ ] **Step 7**: Wait for results (should complete in <10 seconds)

### What To Observe

**On Device Screen:**
- Look for ✅ or ❌ marks
- Read any error messages
- Note timestamps

**In Metro Console (Terminal):**
Open terminal where Metro is running and look for:
```
[BRIDGE_TEST] ✅ IVSBroadcastModule found
[BRIDGE_TEST] testBridge callback fired!
[BRIDGE_TEST] ✅✅✅ SUCCESS: Bridge is working!
```

**In Android Logcat (New Terminal):**
```bash
adb logcat IVS_NATIVE:D ReactNativeJS:D *:S
```

Look for:
```
D/IVS_NATIVE: [NATIVE] **TEST BRIDGE METHOD CALLED**
D/IVS_NATIVE: [NATIVE] startHostSession called: ...
D/IVS_NATIVE: [NATIVE] startSession() called with ...
```

## 📊 Diagnostic Decision Tree

### Scenario 1: "SUCCESS: Bridge is working!" ✅
**Conclusion:** JS↔Native bridge is functional
**Next Steps:**
- [ ] The problem is in `startSession()` implementation
- [ ] Review: BroadcastSession creation, listener attachment, session.start()
- [ ] Check for exceptions or infinite loops
- [ ] Verify AWS IVS token is valid
- [ ] Ensure network/firewall allows IVS RTMPS connection

### Scenario 2: "testBridge timeout" ❌
**Conclusion:** Bridge layer is completely broken
**Next Steps:**
- [ ] Run: `npx expo run:android --clean`
- [ ] Verify IVSBroadcastModule.kt compiles (check for syntax errors)
- [ ] Check that @ReactMethod annotations are present
- [ ] Verify IVSPackage.kt includes IVSBroadcastModule
- [ ] Check Android SDK version compatibility

### Scenario 3: "Exception calling testBridge" ❌
**Conclusion:** Callback signature or parameter marshaling issue
**Next Steps:**
- [ ] Review React Native version in package.json
- [ ] Check Callback import is from correct package
- [ ] Verify no Kotlin type mismatches (String vs Int, etc.)
- [ ] Try simpler callback signature

### Scenario 4: startHostSession callback fires with error ⚠️
**Conclusion:** Bridge works, but native method failed
**Next Steps:**
- [ ] Check error message details
- [ ] Review startSession() for exception
- [ ] Verify BroadcastSession creation succeeds
- [ ] Check AWS IVS endpoint is reachable

## 🔧 Troubleshooting Quick Fixes

### If Bridge Test Won't Show on Device
```bash
# Full rebuild
rm -rf node_modules/.bin/expo
npm install
npx expo run:android --clean
```

### If Metro Console Shows Nothing
```bash
# Restart Metro with clear
# Kill all node processes first
pkill -f node
# Start fresh
npx expo start --dev-client --clear
```

### If Logcat Shows No IVS_NATIVE Logs
```bash
# Verify native rebuild completed
cd android && ./gradlew clean && cd ..
npx expo run:android --verbose

# Check logcat is filtering correctly
adb logcat | grep IVS_NATIVE
```

### If Device Shows "IVSBroadcastModule not found"
```bash
# Native module not registered
# Check: android/app/src/main/java/com/blyp/mobile/MainApplication.kt
# Should have: add(IVSPackage()) in getPackages()

# Rebuild
npx expo run:android --clean
```

## 📝 Documentation Index

- **BRIDGE_TEST_GUIDE.md** - Step-by-step test instructions
- **BRIDGE_TEST_INTEGRATION_EXAMPLE.txt** - Code sample for App.js
- **IVS_DIAGNOSTIC_SUMMARY.md** - Complete diagnosis report
- **This file** - Checklist & next steps

## 🎯 Success Criteria

Bridge Test is successful when:
- [ ] Metro console shows: `[BRIDGE_TEST] ✅✅✅ SUCCESS: Bridge is working!`
- [ ] Logcat shows IVS_NATIVE logs with timestamps
- [ ] testBridge() and startHostSession() both fire callbacks
- [ ] No exceptions or timeouts reported

## ⏰ Estimated Time

- Reading this: 3 minutes
- Integrating BridgeTest: 2 minutes
- Running test on device: 2 minutes
- Interpreting results: 2 minutes
- **Total: ~10 minutes to diagnosis**

## 🚨 If All Else Fails

1. Verify device is connected: `adb devices`
2. Verify app is running: Check device screen
3. Verify Metro is running: Look at terminal window
4. Check for typos in imports/routes
5. Try full clean rebuild:
   ```bash
   rm -rf android/build node_modules
   npm install
   cd android && ./gradlew clean && cd ..
   npx expo run:android --clean
   ```

## Contact Point

If bridge test shows bridge IS working but live stream still fails:
1. Problem is in startSession() → focus on BroadcastSession logic
2. Review AWS IVS SDK documentation for BroadcastSession state machine
3. Add more granular logging inside startSession() listener callbacks
4. Verify token, endpoint, and session parameters are correct

If bridge test shows bridge IS NOT working:
1. This is a React Native linking issue
2. Verify gradle versions in build.gradle
3. Check Android SDK versions in local.properties
4. Try: `npx expo install --fix`
5. Last resort: `npm install` + `npx expo run:android --clean`

---

**Created:** December 8, 2025
**Status:** Ready for Testing
**Next Action:** Add BridgeTestScreen to App.js and navigate to it
