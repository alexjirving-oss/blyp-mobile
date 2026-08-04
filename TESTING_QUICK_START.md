# ⚡ QUICK ACTION GUIDE — Connect Both Devices & Test

**Copy-Paste Ready Commands Below**

---

## YOUR SETUP

```
Computer IP:        192.168.1.236
Device 1 (USB):     RFCY71ZFS6F (already connected)
Device 2 (WiFi):    [Get IP from Device 2 settings]
Backend Running:    ✅ YES (port 8072)
Expo Running:       ✅ YES (port 8083)
```

---

## STEP 1: Get Device 2 IP (Do This On Device 2)

On Device 2:
1. Go to **Settings → Network & Internet → WiFi**
2. Tap the WiFi network you're connected to
3. Look for "IP address" - note it down
   - Example: `192.168.1.105`

---

## STEP 2: Connect Device 2 via WiFi (Run in PowerShell)

```powershell
# First, disconnect if previously connected:
adb disconnect

# Then connect via WiFi (use Device 2 IP from Step 1):
adb connect 192.168.1.105:5555

# Verify both devices connected:
adb devices -l
```

**Expected Output:**
```
RFCY71ZFS6F            device
192.168.1.105:5555     device
```

---

## STEP 3: Install Apps on Both Devices

**Option A: Using Expo Go (Faster)**
```powershell
# On both devices, install "Expo Go" from Play Store
# Open Expo Go app
# Click "Scan QR Code"
# Use phone camera to scan QR code from Expo terminal
```

**Option B: Using Dev Client (Better for IVS)**
```powershell
# Already built, just push to both devices:
adb install ./android/app/build/outputs/apk/debug/app-debug.apk
adb -s 192.168.1.105:5555 install ./android/app/build/outputs/apk/debug/app-debug.apk
```

---

## STEP 4: Verify Servers Running

```powershell
# Check ports:
netstat -ano | findstr "8072\|8083\|3001"

# Should see all three running
```

---

## STEP 5: Start Testing

### Device 1 (Hardwired USB) - HOST
```powershell
# In terminal, open app and:
1. Go to Live screen
2. Press "Go Live"
3. Confirm camera preview visible
4. Watch logs:
   adb logcat | grep "IVS_NATIVE"
```

### Device 2 (WiFi) - VIEWER
```powershell
# In different terminal, open app and:
1. Search for streams or go to Discover
2. Find Device 1's stream
3. Press to join
4. 🎬 CHECK: Video displays? (should NOT be black screen)
5. Watch logs:
   adb -s 192.168.1.105:5555 logcat | grep "IVS_NATIVE"
```

---

## 📊 What to Look For

### If Working (✅)
**Device 1 Logs:**
```
[IVS_NATIVE] Starting broadcast: sessionId=...
IVS_BROADCAST_STARTED
```

**Device 2 Logs:**
```
[IVS_NATIVE] Joining as viewer via IVS Player (playback): playbackUrl=https://...
IVS_VIEWER_JOINED
IVS_PLAYER_STATE_CHANGED: state=READY
IVS_PLAYER_FIRST_FRAME ✅ (Video is rendering!)
```

### If Black Screen (❌)
Look for missing line:
```
IVS_PLAYER_FIRST_FRAME (NOT PRESENT - means video didn't render)
```

Then check:
```powershell
adb -s 192.168.1.105:5555 logcat | grep "Error\|Exception\|playbackUrl"
```

---

## 🚨 Emergency Troubleshooting

### Servers Not Responding?
```powershell
# Kill and restart:
adb kill-server
adb start-server

# Restart backends:
# Terminal 1: Ctrl+C then: firebase emulators:start --only functions
# Terminal 2: Ctrl+C then: npx expo start --dev-client --port 8083 --host lan
```

### Device 2 Won't Connect?
```powershell
# Disconnect and retry:
adb disconnect 192.168.1.105:5555

# Wait 2 seconds, then:
adb connect 192.168.1.105:5555

# Or reset entire ADB:
adb kill-server
adb start-server
adb connect 192.168.1.105:5555
```

### App Not Loading?
```powershell
# Clear Expo cache:
rm -r ~/.expo ~/.cache/expo

# Restart Expo:
npx expo start --dev-client --port 8083 --host lan --clear
```

---

## ✅ SUCCESS CHECKLIST

- [ ] Device 1 connected via USB
- [ ] Device 2 connected via WiFi (adb devices shows both)
- [ ] Backend running (firebase emulator on port 8072)
- [ ] Expo running (metro bundler, shows QR code)
- [ ] App launches on both devices
- [ ] Device 1: Go live button works
- [ ] Device 2: Can join stream
- [ ] **🎬 Device 2: VIDEO DISPLAYS (NOT BLACK SCREEN)**
- [ ] Logs show all expected IVS messages

---

## 📱 Device 2 Setup (One-Time Only)

If Device 2 doesn't have WiFi debugging enabled yet:

```
1. Go to Settings
2. Scroll to "About phone"
3. Tap "Build Number" exactly 7 times
4. Now "Developer Options" appears in Settings
5. Go to Developer Options
6. Enable "USB Debugging"
7. (Optional) Enable "TCP/IP Debugging"
8. Connect to same WiFi as Device 1
```

---

## 💡 Pro Tips

- **Keep both devices unlocked** during testing
- **Same WiFi network** is CRITICAL (192.168.1.x)
- **Monitor logs in separate terminal** for real-time debugging
- **Test multiple times** to verify consistency
- **Take screenshots** if issue occurs for debugging

---

## 🎯 FINAL TEST COMMAND

Run this to verify everything works:

```powershell
# Terminal 1: Backend
cd c:\Users\Alex\369369369\functions
firebase emulators:start --only functions

# Terminal 2: Expo
cd c:\Users\Alex\369369369
npx expo start --dev-client --port 8083 --host lan

# Terminal 3: Monitor Device 1
adb logcat | grep "IVS_NATIVE"

# Terminal 4: Monitor Device 2
adb -s 192.168.1.105:5555 logcat | grep "IVS_NATIVE"
```

Then test:
1. Device 1 goes live
2. Device 2 joins
3. **Look for: `IVS_PLAYER_FIRST_FRAME` = SUCCESS ✅**

---

**This is all you need. Ping me if you get stuck!**
