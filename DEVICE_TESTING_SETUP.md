# Device Testing Setup Guide — IVS Viewer Black Screen Fix

**Date:** December 10, 2025  
**Backend Server IP:** 192.168.1.236  
**Backend Port:** 3001  

---

## Device Status

### Device 1: Hardwired (USB)
- **Serial:** RFCY71ZFS6F
- **Model:** Samsung Galaxy Z Fold 6 (SM_F966B)
- **Status:** ✅ CONNECTED (USB)
- **WiFi IP:** 192.168.1.210
- **Connection Type:** Hardwired USB

### Device 2: WiFi (To be connected)
- **Status:** ⏳ NEEDS SETUP
- **Connection Type:** WiFi over TCP/IP

---

## Ports Status

| Port | Service | Status |
|------|---------|--------|
| 3000 | Backend Dev | ✅ AVAILABLE |
| 3001 | Backend API | ✅ AVAILABLE |
| 5173 | Vite/Dev Server | ✅ AVAILABLE |
| 8080 | Expo Metro | ✅ AVAILABLE |

---

## Setup Instructions

### Step 1: Enable Developer Options on Device 2 (WiFi)

1. Open Settings
2. Scroll to "About phone"
3. Tap "Build number" 7 times
4. Developer options now visible in Settings
5. Enable "USB Debugging"
6. Enable "TCP/IP Debugging over WiFi" (if available)

### Step 2: Connect Device 2 via WiFi

```powershell
# Get Device 2 serial number (connect via USB first if needed)
adb devices

# Once you have the serial, connect via WiFi:
# adb connect <DEVICE_2_IP>:5555

# Example:
adb connect 192.168.1.XXX:5555

# Verify connection:
adb devices -l
```

### Step 3: Update Backend Configuration

Uncomment the API base URL in `.env`:

```bash
# File: .env (line ~16)
# Change from:
# EXPO_PUBLIC_API_BASE_URL=http://192.168.1.236:3001

# To:
EXPO_PUBLIC_API_BASE_URL=http://192.168.1.236:3001
```

### Step 4: Start Backend Server

```bash
cd c:\Users\Alex\369369369\functions
npm run serve
```

Expected output:
```
⚠  functions: Using node@20 from host.
✔  Started emulator.

│ Listening at localhost:5001
```

The backend will be available at: `http://192.168.1.236:3001`

### Step 5: Start Expo Dev Server

In a **new terminal**:

```bash
cd c:\Users\Alex\369369369
npx expo start --dev-client --port 8083 --host lan
```

Expected output:
```
› Metro waiting on exp://192.168.1.236:8083
```

### Step 6: Launch App on Both Devices

**Option A: Physical Devices (Recommended)**

Device 1 (Hardwired - USB):
```bash
# In the Metro bundle terminal, press 'a' for Android
# Select Device 1 from the list
```

Device 2 (WiFi - TCP/IP):
```bash
# Install dev client on Device 2 if not already installed
adb -s <DEVICE_2_SERIAL> install -r <path_to_devClient_apk>

# Or manually open Expo Go and scan QR code from terminal
```

**Option B: Expo Go (For Testing)**

On both devices:
1. Install "Expo Go" from Google Play Store
2. Scan the QR code displayed in the terminal
3. App will load on both devices simultaneously

---

## Verification Checklist

### Backend Ready ✅
- [ ] Firebase Functions emulator running (`npm run serve`)
- [ ] Port 3001 accessible
- [ ] API responses successful

### Devices Ready ✅
- [ ] Device 1: USB connected and showing in `adb devices`
- [ ] Device 2: WiFi connected and showing in `adb devices -l`
- [ ] Both devices have required permissions granted

### App Ready ✅
- [ ] Expo dev server running (`npx expo start`)
- [ ] App installed on Device 1
- [ ] App installed on Device 2
- [ ] Both apps show same version

### Testing Ready ✅
- [ ] Host: Can go live (Device 1)
- [ ] Viewer: Can join stream (Device 2)
- [ ] **CRITICAL:** Viewer displays video (NOT black screen)

---

## Manual Device Testing

### Host Device (Device 1 - USB)

```
1. Open app
2. Navigate to Live Screen
3. Tap "Go Live" button
4. Grant camera/microphone permissions
5. Confirm camera preview visible
6. Check logcat for IVS logs:
   adb logcat | grep "IVS_NATIVE"
```

### Viewer Device (Device 2 - WiFi)

```
1. Open app
2. Navigate to Discover/Home
3. Search for or find host's stream
4. Tap to join stream
5. Check logcat for IVS logs:
   adb -s <DEVICE_2_SERIAL> logcat | grep "IVS_NATIVE"
6. ✅ CRITICAL: Verify video displays (NOT black screen)
```

---

## Expected Logs

### Host Starting Broadcast
```
[IVS_NATIVE][CONFIG] { ... }
[IVS_NATIVE] Starting broadcast: sessionId=...
IVS_BROADCAST_STARTED
IVS_LOCAL_MEDIA_CHANGED: camera=true, mic=true
```

### Viewer Joining Stream
```
[IVS_NATIVE] Joining as viewer via IVS Player (playback): 
  sessionId=..., playbackUrl=https://...
IVS_VIEWER_JOINED
IVS_PLAYER_STATE_CHANGED: state=READY
IVS_PLAYER_FIRST_FRAME
```

---

## Troubleshooting

### Device Won't Connect via WiFi

```bash
# Disconnect and reconnect
adb disconnect <DEVICE_2_IP>:5555
adb connect <DEVICE_2_IP>:5555

# Or reset ADB:
adb kill-server
adb start-server
adb devices
```

### Backend Not Accessible

```bash
# Verify backend is running:
netstat -ano | findstr "3001"

# Test connectivity:
curl http://192.168.1.236:3001/health

# Check Windows firewall:
# Settings > Firewall & Network Protection > Allow an app through firewall
# Ensure Node.js has permission
```

### App Can't Find Backend

```bash
# In .env, verify:
EXPO_PUBLIC_API_BASE_URL=http://192.168.1.236:3001

# Restart Expo dev server:
npm run dev  # or npx expo start --dev-client --port 8083 --host lan

# Check Metro logs for:
# [IVS_API][CONFIG] API_BASE_URL: ✓ set
```

### Still Seeing Black Screen

```bash
# 1. Check backend returns playbackUrl:
curl -X POST http://192.168.1.236:3001/api/ivs/viewer-join \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{"streamId":"test-stream"}'

# 2. Verify native player is rendering:
adb -s <DEVICE_2_SERIAL> logcat | grep "PlayerView\|PLAYER"

# 3. Check IVS permissions on Android:
adb shell pm list permissions | grep camera

# 4. Clear app cache and reinstall:
adb -s <DEVICE_2_SERIAL> shell pm clear com.blyp.mobile
```

---

## Running Parallel Sessions

### Terminal 1: Backend Server
```bash
cd c:\Users\Alex\369369369\functions
npm run serve
```

### Terminal 2: Expo Dev Server
```bash
cd c:\Users\Alex\369369369
npx expo start --dev-client --port 8083 --host lan
```

### Terminal 3: Device 1 Logs (Optional)
```bash
adb logcat | grep "IVS_NATIVE"
```

### Terminal 4: Device 2 Logs (Optional)
```bash
adb -s <DEVICE_2_SERIAL> logcat | grep "IVS_NATIVE"
```

---

## Quick Reference Commands

```bash
# List all devices
adb devices -l

# Connect WiFi device
adb connect 192.168.1.XXX:5555

# View device logs
adb logcat | grep "IVS_NATIVE"

# Push file to device
adb push <LOCAL_FILE> /data/local/tmp/

# Pull file from device
adb pull /data/local/tmp/<FILE> .

# Kill ADB server (if stuck)
adb kill-server

# Restart ADB
adb start-server

# Get device IP
adb shell ip addr show wlan0
```

---

## Success Criteria

✅ **Device 1 (USB):** Host goes live, camera preview visible  
✅ **Device 2 (WiFi):** Joins stream, **VIDEO DISPLAYS** (not black screen)  
✅ **Backend:** Responds to viewer-join with playbackUrl  
✅ **Logs:** Both devices show proper IVS state transitions  
✅ **Network:** Both devices on same WiFi network (192.168.1.x)

---

## Next Steps After Testing

1. ✅ Verify video displays on Device 2
2. Test multiple concurrent viewers
3. Test on different Android versions
4. Merge branch to main
5. Deploy to production

---

**Setup Date:** December 10, 2025  
**Backend Server:** 192.168.1.236:3001  
**Status:** Ready for device testing
