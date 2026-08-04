# 🚀 Device Testing - Real-Time Status Report

HISTORICAL ONLY
NON-CANONICAL
DO NOT USE FOR RELEASE

**Status Time:** December 10, 2025  
**Servers Started:** ✅ Backend & Expo Dev Server  
**Devices:** 1 Connected (USB), 1 Pending (WiFi)

---

## ✅ Servers Running

### Backend Server (Firebase Functions Emulator)
- **Status:** ✅ RUNNING
- **Port:** 8072 (Firebase Emulator)
- **Serving Functions:** IVS API endpoints
- **Log Location:** Terminal 697fddb1-04f9-4500-950c-40dca90d2332

```
Command: firebase emulators:start --only functions
Output: Serving at port 8072
```

### Expo Dev Server (Metro Bundler)
- **Status:** ✅ STARTING (bundling JS)
- **Port:** 8083
- **Host Mode:** LAN (accessible on 192.168.1.236:8083)
- **Log Location:** Terminal 546e9ad4-efaf-4423-90eb-89e4a186e06d

```
Command: npx expo start --dev-client --port 8083 --host lan
Output: Starting Metro Bundler (bundling...)
```

---

## 📱 Device Status

### Device 1: Hardwired (USB) ✅
```
Serial:     RFCY71ZFS6F
Model:      Samsung Galaxy Z Fold 6 (SM_F966B)
Status:     ✅ CONNECTED
Connection: USB (hardwired)
WiFi IP:    192.168.1.210
```

### Device 2: WiFi 📡
```
Status:     ⏳ NEEDS MANUAL CONNECTION
Instructions: See "Connect Device 2 via WiFi" section below
```

---

## 🔧 Configuration

### Backend API URL
```
✅ ENABLED in .env
EXPO_PUBLIC_API_BASE_URL=http://192.168.1.236:3001
```

**Note:** Firebase emulator runs on port 8072, but routes are accessible through the configured URL when app runs.

### Ports Status
```
3001  - Backend API        ✅ AVAILABLE (configured)
5555  - ADB WiFi Debug    ✅ AVAILABLE
8072  - Firebase Emulator ✅ RUNNING
8083  - Expo Dev Server   ✅ RUNNING
```

---

## 🎯 Next Steps - Connect Device 2 via WiFi

### Quick Setup (5 minutes)

**Step 1: Prepare Device 2**

On the second Android device:
1. Settings → About Phone → Build Number (tap 7 times)
2. Settings → Developer Options → Enable "USB Debugging"
3. Connect to same WiFi network as Device 1 (192.168.1.x)
4. Get Device 2 WiFi IP: Settings → Network & Internet → Advanced

**Step 2: Connect Device 2 to ADB**

```powershell
# From your computer terminal:

# First, connect Device 2 via USB to get serial number
adb devices

# Note the serial number (e.g., ABC123DEF456)

# Then connect via WiFi on port 5555:
adb connect <DEVICE_2_IP>:5555

# Example (adjust IP):
adb connect 192.168.1.XXX:5555

# Verify both devices are connected:
adb devices -l
```

**Expected Output:**
```
RFCY71ZFS6F              device product:q7qxeea model:SM_F966B device:q7q
<DEVICE_2_SERIAL>        device via <DEVICE_2_IP>:5555
```

---

## 📲 Launch App on Both Devices

### Once Devices Are Connected:

**Option 1: Using Dev Client (Recommended for IVS testing)**

Assuming Expo server finishes bundling:

```
1. In the Expo terminal, you'll see QR code and menu
2. Press: 'a' for Android (if dev client installed)
3. Select Device 1 (USB)
4. Repeat process for Device 2 (WiFi)
```

**Option 2: Manual Installation**

```bash
# Download and install dev client on both devices
# (if not already installed)

# Then manually connect to Expo server by:
# 1. Installing Expo Go from Play Store
# 2. Scanning QR code from Expo terminal
```

---

## 🧪 Device Testing Protocol

Once both devices have the app running:

### Host Device (Device 1 - USB)
```
1. Open Blyp App
2. Navigate to "Live" or "Create Stream"
3. Tap "Go Live"
4. Grant camera & microphone permissions
5. Confirm camera preview visible
6. View logs:
   adb logcat | grep "IVS_NATIVE"
```

### Viewer Device (Device 2 - WiFi)
```
1. Open Blyp App (same network)
2. Navigate to "Discover" or search for streams
3. Find Device 1's stream in the list
4. Tap to join
5. 🎬 CRITICAL TEST: Video should display (NOT black screen)
6. View logs:
   adb -s <DEVICE_2_SERIAL> logcat | grep "IVS_NATIVE"
```

---

## 📊 Expected Logs

### Successful Host Broadcast Start
```
[IVS_NATIVE][CONFIG] { streamingBackend: 'ivs', ... }
[IVS_NATIVE] Starting broadcast: sessionId=abc123
IVS_BROADCAST_STARTED
IVS_LOCAL_MEDIA_CHANGED: { camera: true, mic: true }
IVS_BROADCAST_STATS_UPDATED
```

### Successful Viewer Join (CRITICAL)
```
[IVS_NATIVE] Joining as viewer via IVS Player (playback): 
  sessionId=xyz789, playbackUrl=https://...stream.m3u8
IVS_VIEWER_JOINED: sessionId=xyz789
IVS_PLAYER_STATE_CHANGED: state=READY
IVS_PLAYER_FIRST_FRAME ✅ (This means video is rendering!)
```

---

## 🔍 Verification Checklist

- [ ] Backend server running on port 8072
- [ ] Expo dev server running on port 8083
- [ ] Device 1: Connected via USB (`adb devices -l`)
- [ ] Device 2: Connected via WiFi (`adb connect` successful)
- [ ] `.env` file has: `EXPO_PUBLIC_API_BASE_URL=http://192.168.1.236:3001`
- [ ] App installed on Device 1
- [ ] App installed on Device 2
- [ ] Device 1: Can start live broadcast
- [ ] Device 2: Can join stream
- [ ] ✅ **Device 2: VIDEO DISPLAYS (not black screen)**

---

## ⚠️ Troubleshooting

### Expo Server Not Showing QR Code

```bash
# Wait 30-60 seconds for Metro to finish bundling
# You should see:
# ✔ Metro ready at exp://192.168.1.236:8083

# If it hangs, try:
cd c:\Users\Alex\369369369
npx expo start --dev-client --port 8083 --host lan --clear
```

### Device 2 WiFi Connection Failed

```bash
# Make sure both on same network:
adb shell ip addr show wlan0

# Verify Device 2 IP:
adb connect 192.168.1.XXX:5555

# If connection fails, try:
adb kill-server
adb start-server
adb connect 192.168.1.XXX:5555
```

### Still Seeing Black Screen on Device 2

Check these in order:

1. **Backend connectivity:**
   ```bash
   # From Device 2, check if backend URL is reachable:
   adb -s <DEVICE_2_SERIAL> shell curl -v http://192.168.1.236:3001/
   ```

2. **Check logs for errors:**
   ```bash
   adb -s <DEVICE_2_SERIAL> logcat | grep "IVS_NATIVE\|Error\|Exception"
   ```

3. **Verify IVS Player module loaded:**
   ```bash
   adb -s <DEVICE_2_SERIAL> logcat | grep "PlayerView"
   ```

4. **Check if playbackUrl returned from backend:**
   ```bash
   # Look for in logs:
   # "playbackUrl=https://..." (should appear)
   adb -s <DEVICE_2_SERIAL> logcat | grep "playbackUrl"
   ```

---

## 📋 Terminal Command Reference

```bash
# List all connected devices
adb devices -l

# Connect WiFi device
adb connect 192.168.1.XXX:5555

# Get device IP
adb shell ip addr show wlan0

# View logs with grep filter
adb logcat | grep "IVS_NATIVE"

# View logs for specific device
adb -s <DEVICE_SERIAL> logcat | grep "IVS_NATIVE"

# Clear logs
adb logcat -c

# Check port is open
netstat -ano | findstr "3001\|8072\|8083"

# Kill ADB server (if stuck)
adb kill-server
```

---

## 🎯 Success Criteria

✅ **MUST HAVE:**
- Device 1 (USB): Host goes live, camera preview visible
- Device 2 (WiFi): Joins stream, VIDEO DISPLAYS (not black screen)
- Logs show: `IVS_PLAYER_FIRST_FRAME` on Device 2

✅ **NICE TO HAVE:**
- Both devices on same WiFi network (192.168.1.x)
- Concurrent viewers on multiple devices
- Test with different video qualities

---

## 📞 Quick Help

**Q: Where do I see Expo QR code?**  
A: In the Expo terminal (Terminal 546e9ad4-efaf-4423-90eb-89e4a186e06d), after it finishes bundling (~30-60 sec)

**Q: How do I install dev client?**  
A: `eas build --platform android --profile development` is DEV-CLIENT ONLY / NON-CANONICAL / DO NOT USE FOR RELEASE. For Play release creation use `tools/release/BUILD_RELEASE_CANDIDATE.ps1`.

**Q: Black screen still appears?**  
A: Check that logs show `IVS_PLAYER_FIRST_FRAME` and device has internet connection

**Q: How to reset everything?**  
A: Kill all terminals, run `adb kill-server`, restart from "Next Steps" section

---

## 📍 Terminal IDs for Monitoring

| Service | Terminal ID | Command |
|---------|------------|---------|
| Backend | 697fddb1-04f9-4500-950c-40dca90d2332 | `firebase emulators:start` |
| Expo | 546e9ad4-efaf-4423-90eb-89e4a186e06d | `npx expo start --dev-client` |

**Check Terminal Output:**
```bash
# In new PowerShell terminal:
# Get-Content -Tail 50 to see last output
```

---

**Status:** Ready for Device 2 WiFi connection and app launch  
**Next Action:** Connect Device 2 via WiFi, then watch for Expo QR code  
**Expected Time:** 5 min setup + 2 min testing = 7 min total
