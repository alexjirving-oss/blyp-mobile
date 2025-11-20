# Blyp Mobile - Complete Troubleshooting Guide

## Quick Start (Recommended)

Run the smart startup script:
```powershell
# Expo Go mode (QR code)
.\start-app.ps1

# Dev client mode (custom build / emulator)
.\start-app.ps1 -DevClient
```

Both modes will:
- Kill hanging Node processes
- Clear Metro bundler cache
- Set up ADB if available
- Start Expo with proper settings

## Common Issues & Solutions

### Issue 0: Dev Client Shows 127.0.0.1 and Fails to Load

**Symptoms**: In the development build list you see the project referencing `127.0.0.1:8081` (or another localhost) and tapping it errors immediately.

**Cause**: Physical devices cannot resolve the host machine's loopback address. Metro started without advertising a LAN or tunnel URL.

**Fix Options**:
```powershell
# Prefer LAN (same Wi-Fi)
./start-app.ps1 -DevClient -Lan

# If LAN unreliable / captive network
./start-app.ps1 -DevClient -Tunnel

# Force specific port
./start-app.ps1 -DevClient -Lan -Port 8090

# Manual fallback (USB already reversed):
adb reverse tcp:8083 tcp:8083
npx expo start --dev-client --port 8083 --host lan
```

If still failing:
- Confirm firewall allows Node.js inbound on the chosen port.
- Disable VPN / corporate proxy temporarily.
- On Windows, ensure no conflicting service is bound to that port (`netstat -ano | findstr :8083`).


### Issue 1: Blank/White Screen on Device

**Symptoms**: App loads but shows blank screen or freezes on loading

**Causes**:
1. Firebase authentication timeout
2. Network connectivity issues
3. Firestore query failures

**Solutions**:
```powershell
# Option A: Restart with clear cache
# (Expo Go)
npx expo start --clear

# Option A2: Dev client restart
npx expo start --dev-client --port 8083

# Option B: Use tunnel mode for better connectivity
npx expo start --tunnel

# Option C: Check Firebase config
# Verify src/config/firebase.js has correct credentials
```

### Issue 2: "Unable to Connect to Dev Server"

**Symptoms**: Device can't connect to Metro bundler

**Solutions**:
```powershell
# 1. Check if server is running
Get-Process -Name node

# 2. Kill and restart
Get-Process -Name node -ErrorAction SilentlyContinue | Stop-Process -Force
npx expo start --clear

# 3. If USB connected, use ADB reverse
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" reverse tcp:8081 tcp:8081

# 4. Try tunnel mode
npx expo start --tunnel
```

### Issue 3: App Crashes Immediately

**Symptoms**: App opens then immediately closes

**Causes**:
1. JavaScript error in app code
2. Native module compatibility issue
3. Firebase configuration error

**Solutions**:
```powershell
# Check logs for errors
npx expo start --clear

# Look for red error messages in terminal
# Common errors:
# - "Firebase: Error (auth/...)" = Auth configuration issue
# - "undefined is not an object" = Missing null check
# - "Network request failed" = Firestore rules or connectivity
```

### Issue 4: "Expo Go app not installed"

**Solution**:
1. Install Expo Go from Google Play Store
2. OR build a development build:
```powershell
eas build --profile development --platform android
```

### Issue 5: Dev Client Fails to Start

**Symptoms**: `npx expo start --dev-client` exits with error

**Solutions**:
```powershell
# Option A: Use regular Expo Go instead
npx expo start --clear

# Option B: Rebuild dev client
npx expo prebuild --clean
eas build --profile development --platform android

# Option C: Install dev client APK
eas build:run -p android
```

### Issue 6: Firebase "Permission Denied"

**Symptoms**: Posts don't load, can't create posts

**Solutions**:
1. Check Firestore rules in Firebase Console
2. Verify user is authenticated:
```javascript
// In console logs, look for:
// [INIT][Firebase] Initialized
// [AUTH] User logged in: ...
```

3. Update Firestore rules if needed (see firestore.rules file)

### Issue 7: Images/Videos Don't Load

**Symptoms**: Posts show but media is missing

**Causes**:
1. Storage URL format issues
2. CORS problems
3. Storage rules restrictions

**Solutions**:
1. Check Storage rules in Firebase Console
2. Verify URLs use `.appspot.com` domain:
```javascript
// Good: https://firebasestorage.googleapis.com/...blyp-master.appspot.com/...
// Bad: https://firebasestorage.googleapis.com/...firebasestorage.app/...
```

### Issue 8: LiveStreaming Not Showing

**This is expected and can be controlled**:

The LiveStream feature uses a feature flag system:
- Check `src/config/StreamingFeatureFlag.js`
- Set `BUILD_ENABLE_LIVE_STREAMING = true` to enable
- Set `BUILD_ENABLE_LIVE_STREAMING = false` to disable

You can also remotely control it via Firestore:
1. Create document: `appConfig/streaming`
2. Set field: `enabled: true` or `false`

### Issue 9: "Metro bundler has encountered an error"

**Solutions**:
```powershell
# Clear all caches
npx expo start --clear

# If that fails, full reset:
Remove-Item -Path "node_modules" -Recurse -Force
Remove-Item -Path ".expo" -Recurse -Force
Remove-Item -Path "package-lock.json" -Force
npm install
npx expo start --clear
```

### Issue 10: Slow Performance / Lag

**Causes**:
1. Too many real-time listeners
2. Large Firestore queries
3. Memory leaks from unmounted components

**Solutions**:
1. Check for console logs showing excessive updates
2. Reduce query limits in HomeScreen.js:
```javascript
// Change from limit(100) to limit(20)
const q = query(collection(db, 'posts'), orderBy('date', 'desc'), limit(20));
```

3. Ensure cleanup functions run:
```javascript
useEffect(() => {
  const unsubscribe = onSnapshot(...);
  return () => unsubscribe(); // This must run
}, []);
```

## Debugging Steps

### 1. Check Server Status
```powershell
# Is Metro running?
Get-Process -Name node

# Check what port it's using
netstat -ano | findstr :8081
```

### 2. Check Device Connection
```powershell
# USB debugging
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" devices

# Should show:
# List of devices attached
# XXXXXXXX       device
```

### 3. Check Firebase Status
Open the app and look for these console logs:
```
[INIT][Firebase] Initialized
[AUTH] User logged in: ...
📱 HOME: Received X videos from Firebase
💰 HOME: Setting up balance subscriptions
```

### 4. Check for JavaScript Errors
Look for red text in terminal:
- "Error:" followed by stack trace
- "TypeError:", "ReferenceError:", etc.
- "Firebase:" auth or firestore errors

## Network Configuration

### Option 1: USB (Recommended)
```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" reverse tcp:8081 tcp:8081
npx expo start --clear
```

### Option 2: LAN (Requires Same WiFi)
```powershell
npx expo start --lan
# Scan QR code with device on same network
```

### Option 3: Tunnel (Slowest but Most Compatible)
```powershell
npx expo start --tunnel
# Works through firewalls and different networks
```

## Complete Reset (Nuclear Option)

If nothing else works:
```powershell
# 1. Stop everything
Get-Process -Name node -ErrorAction SilentlyContinue | Stop-Process -Force

# 2. Delete all caches and builds
Remove-Item -Path "node_modules" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path ".expo" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path "android/.gradle" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path "ios/Pods" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path "package-lock.json" -Force -ErrorAction SilentlyContinue

# 3. Reinstall
npm install

# 4. Clear Expo cache
npx expo start --clear
```

## Getting Help

If issues persist:
1. Check the terminal output for specific error messages
2. Look at device logs using `adb logcat`
3. Review Firebase Console for authentication/database errors
4. Check the documentation files:
   - `REAL_ISSUES_ANALYSIS.md` - Understanding what went wrong
   - `LIVESTREAM_ROLLBACK_PLAN.md` - Feature flag management
   - `BUILD-GUIDE.md` - Building for production

## Success Indicators

You'll know it's working when:
- ✅ QR code appears in terminal
- ✅ "Metro waiting on..." message shows
- ✅ Device connects without errors
- ✅ App loads and shows HomeScreen
- ✅ Posts/videos are visible
- ✅ No red errors in terminal

## Performance Monitoring

Watch these logs for health:
```
✓ Firebase initialized
✓ User logged in
✓ Received N posts/videos
✓ Balance subscriptions active
```

Avoid seeing these repeatedly:
```
✗ Error in video data listener
✗ Permission denied
✗ Network request failed
✗ Timeout waiting for...
```