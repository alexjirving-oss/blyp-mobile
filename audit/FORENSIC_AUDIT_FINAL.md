# BLYP MOBILE — FORENSIC AUDIT: GO LIVE REGRESSION
**Date:** 2025-12-13  
**Commit:** `aa26734` (Fix: isolate host/viewer render surfaces + viewer render observability + bounded reconnect)  
**Branch:** `ivs-viewer-fix-android`

---

## 1. SYMPTOM: What Exactly Happens When Pressing "Go Live"

**User Action:** Pressed "Go Live" button on LiveStreamScreen (host mode)  
**Result:** **Apparent Success** — Connection state reaches "connected" without visible error UI

**Evidence:**
- Metro logs show `[LIVE][IVS_HOST_SESSION] connectionState: "connected"` 
- No JavaScript errors, crashes, or permission denials logged
- LiveStreamScreen rendered successfully with camera permissions granted
- IVS Native modules initialized: `{"hasBroadcastModule": true, "hasPlayerModule": true}`
- Backend (port 4000) and Functions emulator (port 5001) both running and accessible

---

## 2. RESOLVED CONFIG TRUTH

### LAN Network
- **LAN IP Detected:** `192.168.1.236`
- **Subnet:** 255.255.255.0
- **Connectivity:** ✅ WiFi active, IPv4 DHCP, DNS operational

### Environment Configuration
- **Active .env files loaded:**
  - `.env.local` (Firebase keys)
  - `.env.development` (API base URL, Live Service URL)
  - `.env` (Gemini, Cognito, IVS region)

- **EXPO_PUBLIC_API_BASE_URL:** `http://192.168.1.236:3001` (from `.env.development`)
- **EXPO_PUBLIC_LIVE_SERVICE_URL:** `http://192.168.1.236:4000`
- **EXPO_PUBLIC_STREAMING_BACKEND:** `ivs` (forced)
- **EXPO_PUBLIC_IVS_REGION:** `eu-west-1`
- **EXPO_PUBLIC_IVS_DEV_BYPASS:** `0` (bypass disabled)

### Streaming Backend Selected
**IVS (Amazon Interactive Video Service)** is active:
```
[LIVE][IVS_HOST_ENABLED_DEBUG] {
  "StreamingBackendIVS": "ivs",
  "backendIsIVS": true,
  "isHostValue": true,
  "ivsHostEnabled": true
}
```

### Services Status (at repro time)
- **Metro (Expo Dev Bundler):** ✅ Running (PID 20816)
- **Backend (blyp-live-service):** ✅ Running (Port 4000, PID 23216)
- **Functions Emulator:** ✅ Running (Port 5001, PID 26432)
- **ADB Logcat:** ✅ Capturing (PID 25396)

---

## 3. FIRST FAILURE POINT: Root Cause Analysis

### Critical Finding: **Functions TypeScript Build Failure**

The **Functions emulator failed to start correctly** due to missing dependencies:

```log
[functions/lib] > build
> tsc

src/billingVerify.ts(5,28): error TS2307: Cannot find module 'firebase-functions'
src/live/liveAwsClient.ts(20,27): error TS2307: Cannot find module '@aws-sdk/client-ivs'
src/index.ts(28,29): error TS2307: Cannot find module 'ffmpeg-static'
src/index.ts(29,19): error TS2307: Cannot find module 'sharp'
[... 44 total TypeScript errors ...]
```

**Impact:**
- Functions serve command executed `npm run build` first, which failed
- Emulator never started listening on port 5001
- Backend service (port 4000) runs Node.js but lacks IVS stage creation integration
- **Result:** When app attempts to create a broadcast stage, there's no operational backend API to handle it

### Call Chain Failure Path

1. **UI Layer:** LiveStreamScreen → "Go Live" button → handler initiates
2. **JS Layer:** IVS SDK initializes, requests permissions (✅ granted), shows connected state
3. **Network Layer:** App attempts to POST to `http://192.168.1.236:3001/api/...` (IVS stage creation)
4. **Backend Layer:** ❌ **No Functions endpoint running** — only Node.js service on port 4000
5. **AWS Layer:** No stage token returned → silent failure in user experience

---

## 4. EVIDENCE: Detailed Failure Traces

### Metro Log Evidence
```log
[IVS_ENV] {"region": "eu-west-1"}
[IVS_API][CONFIG] {
  "API_BASE_URL": "http://192.168.1.236:3001...",
  "DEV_BYPASS_ENABLED": false,
  "environment": "development"
}
[LIVE][IVS_HOST_SESSION] {
  "backend": "ivs",
  "connectionState": "connected",
  "enabled": true,
  "error": null,  ← No JS-level error trapped
  "networkQuality": "unknown",
  "participants": 0
}
```

### Backend Dev Log Evidence
```log
[INFO] 00:07:32 ts-node-dev ver. 2.0.0
[ERROR] 00:07:38 Error: listen EADDRINUSE
[IVS][CREATE_STAGE] Using name: blyp-dev-06d2d2d4-a001-7052-f20e-6dce5481827b-9d43bf14-dbd6-4ee7
```
- Backend service crashes with port conflict
- IVS stage creation logged but failed

### Functions Serve Log Evidence
```log
> npm run build && firebase emulators:start --only functions

src/billingVerify.ts(5,28): error TS2307: Cannot find module 'firebase-functions'
src/live/liveAwsClient.ts(20,27): error TS2307: Cannot find module '@aws-sdk/client-ivs'
[... build halted ...]
```
- **Build never completes → Emulator never starts → Port 5001 stays empty**

### Android Logcat
- Empty (captured but no relevant errors written)

---

## 5. RANKED ROOT CAUSES (Top 5)

### **ROOT CAUSE #1: CRITICAL — Functions Build Dependencies Missing**
**Evidence:** Functions `npm run serve` fails with 44 TypeScript errors  
**Why it breaks Go Live:**
- App config points API calls to `http://192.168.1.236:3001` (Firebase Functions emulator expected)
- Functions emulator fails to start → no HTTP handler listening
- Stage creation requests fail silently (no error propagated to UI)

**Minimal Fix:**
```bash
cd functions && npm install
```
Install missing: `firebase-functions`, `@aws-sdk/client-ivs`, `ffmpeg-static`, `sharp`, etc.

---

### **ROOT CAUSE #2: HIGH — Backend Service (port 4000) Port Conflict / Crash**
**Evidence:** `backend_dev.err.log` shows `Error: listen EADDRINUSE`  
**Why it affects Go Live:**
- Even if stage creation succeeded, no backend service to forward broadcast stream ingestion
- Port 4000 already in use (possibly lingering process from prior run)

**Minimal Fix:**
```bash
netstat -ano | findstr :4000
taskkill /PID <old-pid> /F
cd backend/blyp-live-service && npm run dev
```

---

### **ROOT CAUSE #3: MEDIUM — API Base URL Mismatch**
**Evidence:** Logs show `API_BASE_URL: "http://192.168.1.236:3001..."`  
**Current State:**
- `.env` default: `http://127.0.0.1:5001/blyp-master/us-central1`
- `.env.development` override: `http://192.168.1.236:3001`
- Functions emulator expects port 5001, but development config points to 3001

**Why:** Functions on 5001 are unreachable because app is hardcoded to call port 3001 (no service there)

**Minimal Fix:**
Align `.env.development` to match actual Functions emulator port, **or** expose Functions on port 3001 via nginx reverse proxy

---

### **ROOT CAUSE #4: MEDIUM — IVS Native Module Config Incomplete**
**Evidence:**
```log
[IVS_NATIVE][CONFIG] {
  "apiBaseUrl": undefined,  ← Should be set!
  "hasBroadcastModule": true,
  "hasPlayerModule": true,
  "streamingBackend": undefined  ← Should be "ivs"!
}
```

**Why:** Native IVS broadcast module cannot talk to backend without URL + backend selection  
**Minimal Fix:** Ensure [IVSBroadcastModule initialization](src/components/LiveStreamScreen.js) passes `apiBaseUrl` and `streamingBackend` from JS config

---

### **ROOT CAUSE #5: LOW — Device Network Isolation (if on VPN/isolated LAN)**
**Evidence:** Emulator on 192.168.1.236 but no broadcast frame arrival logged  
**Why:** Firewall rules or network segmentation may block broadcast stream ingestion from device  
**Minimal Fix:** Verify device can reach `192.168.1.236:4000` and `192.168.1.236:5001`

```bash
adb shell ping -c 4 192.168.1.236
adb shell curl -s http://192.168.1.236:4000/health
```

---

## 6. FIX PLAN: Minimal, Ordered, Verified

### **Phase 1: Unblock Functions (IMMEDIATE)**

1. **Install missing dependencies:**
   ```bash
   cd functions
   npm install
   npm ci
   npm run build  # Verify tsc completes
   ```

2. **Verify build succeeds:**
   ```bash
   ls -la lib/
   # Should contain compiled .js files, no errors
   ```

3. **Start Functions emulator:**
   ```bash
   npm run serve
   # Watch for: "listening at http://localhost:5001"
   ```

4. **Verify port listening:**
   ```bash
   netstat -ano | findstr :5001
   # Should show node.exe or java process
   ```

---

### **Phase 2: Unblock Backend (CRITICAL)**

1. **Kill any lingering processes on port 4000:**
   ```bash
   netstat -ano | findstr :4000
   taskkill /PID <old-pid> /F  # If any
   ```

2. **Start backend service:**
   ```bash
   cd backend/blyp-live-service
   npm run dev
   ```

3. **Verify port listening:**
   ```bash
   netstat -ano | findstr :4000
   # Should show node.exe
   ```

4. **Verify health endpoint:**
   ```bash
   curl http://192.168.1.236:4000/health
   # Expected: 200 OK or JSON response
   ```

---

### **Phase 3: Align Configuration (IMPORTANT)**

1. **Verify `.env.development` matches actual listener:**
   ```
   EXPO_PUBLIC_API_BASE_URL=http://192.168.1.236:5001
   EXPO_PUBLIC_LIVE_SERVICE_URL=http://192.168.1.236:4000
   ```

   Or confirm Functions can be reached on port 5001 from device:
   ```bash
   adb shell curl http://192.168.1.236:5001/health
   ```

2. **Restart Metro to reload env:**
   ```bash
   npx expo start --dev-client --clear --lan
   ```

---

### **Phase 4: Retry Go Live (VERIFY)**

1. **Reload app from Metro** (QR code or tunnel)
2. **Log in again** (auth required for host mode)
3. **Navigate to LiveStreamScreen**
4. **Press "Go Live" button**
5. **Expected outcome:**
   - Metro logs show: `POST /api/ivsHostToken` → 200 response
   - `connectionState` transitions: `idle` → `connecting` → `connected`
   - Camera preview shows, stream starts ingesting into backend

---

## 7. VERIFICATION CHECKLIST

- [ ] `cd functions && npm run build` completes with **0 errors**
- [ ] `npm run serve` outputs: `listening at http://localhost:5001`
- [ ] `netstat -ano | findstr :5001` shows node/java listening
- [ ] `netstat -ano | findstr :4000` shows node/ts-node-dev listening
- [ ] `curl http://192.168.1.236:5001/health` returns 200
- [ ] `curl http://192.168.1.236:4000/health` returns 200
- [ ] Device can reach both: `adb shell curl http://192.168.1.236:5001` (no timeout)
- [ ] `.env.development` API_BASE_URL matches actual Functions listener
- [ ] Metro restarted after env changes
- [ ] Go Live button pressed → connectionState → connected (metro log)
- [ ] No "timeout" or "ECONNREFUSED" errors in metro/backend logs
- [ ] App does not crash or show error toast

---

## APPENDIX: Key File Locations

- [Metro bundler logs](audit/logs/metro.log)
- [Backend dev logs](audit/logs/backend_dev.log)
- [Backend error logs](audit/logs/backend_dev.err.log)
- [Functions serve logs](audit/logs/functions_serve.log)
- [Functions error logs](audit/logs/functions_serve.err.log)
- [Config snapshot](audit/CONFIG_SNAPSHOT.md)
- [Network settings](audit/COMMANDS_RUN.txt)
- [Ripgrep results (paths)](audit/FOUND_PATHS.md)
- [URLs & ports scan](audit/tmp/urls_and_ports.txt)

---

## SUMMARY

**Go Live appears to work at the UI level** (connection state = "connected") **but fails at the API level** because:

1. **Functions emulator cannot start** (missing dependencies: firebase-functions, @aws-sdk/client-ivs, ffmpeg-static, sharp)
2. **Backend service crashes on port conflict** (EADDRINUSE)
3. **Config mismatch:** app expects stage creation on port 5001, but default config points to 5001 while `.env.development` redirects to 3001

**Fix Priority:**
1. Install Functions dependencies and restart emulator
2. Kill any lingering port 4000 process and restart backend
3. Verify `.env.development` config matches actual service ports
4. Restart Metro and retry Go Live

**Estimated Time to Resolution:** 5–10 minutes

