# IVS Real-Time Mobile Integration - Testing Guide

**Date:** December 11, 2025  
**Status:** Backend running, mobile env updated  
**Backend URL:** http://192.168.1.236:4000 (LAN) / http://localhost:4000 (PC)

---

## ✅ SETUP COMPLETE

### STEP A – Environment Updated ✓
- File: `.env.development`
- Added: `EXPO_PUBLIC_LIVE_SERVICE_URL=http://192.168.1.236:4000`
- This tells the mobile app to send all live backend calls to the new service on port 4000

### STEP B – Backend Running ✓
- Service: `blyp-live-service`
- Status: **LISTENING on port 4000**
- Terminal output: `blyp-live-service listening on port 4000`
- Logs will show incoming `/api/live/*` calls from the app

---

## 📋 NEXT: Test Host + Viewer

### STEP C – Sanity Check (Optional but Recommended)

**On your phone (connected to same WiFi as PC):**

1. Open phone browser
2. Go to: `http://192.168.1.236:4000/health`
3. You should see:
   ```json
   {"ok":true,"service":"blyp-live-service"}
   ```

If you see the JSON, your phone can reach the backend ✓

---

### STEP D – Restart Mobile App

**In a terminal (mobile repo root):**

```powershell
cd c:\Users\Alex\369369369
npm run start
# or: npx expo start --dev-client --clear
```

**IMPORTANT:** If Metro was already running before you edited `.env.development`, stop it first (Ctrl+C) and restart so the new env is picked up.

---

### STEP E – Test on Two Devices

#### Phone A (Host)

1. Log into the Blyp app
2. Navigate to **Live / Create Live** screen
3. **Verify streaming backend is set to IVS** (not HLS or HLS_LOCAL)
4. Tap **"Go Live"** button
5. Expected behavior:
   - Your phone camera preview appears
   - Live UI shows (title, controls, etc.)
   - **Backend terminal should show:**
     ```
     [LIVE_API][START_HOST_LIVE] ...
     POST /api/live/start
     Response status: 200
     ```
   - No red error screen
6. If error: Check console (Shift+M in Expo Go or dev client) for error details

#### Phone B (Viewer)

1. On Phone B, open Blyp app
2. Navigate to **Live / Live Feed** or however your app lists active lives
3. Find and tap the stream from Phone A (host)
4. Expected behavior:
   - Loading spinner briefly appears
   - **Viewer sees live video/audio from Phone A**
   - Latency should be very low (< 1-2 seconds)
   - **Backend terminal should show:**
     ```
     [LIVE_API][JOIN_LIVE_REALTIME] ...
     POST /api/live/join-realtime
     Response status: 200
     ```
   - No black screen; video should be visible

---

## 🔍 What to Look For

### Success Indicators

| Component | Success Sign |
|-----------|--------------|
| **Backend** | Terminal shows "listening on port 4000" |
| **Mobile Env** | App calls `http://192.168.1.236:4000/api/live/*` |
| **Host Flow** | `POST /api/live/start` succeeds, camera preview appears |
| **Viewer Flow** | `POST /api/live/join-realtime` succeeds, video appears |
| **Real-Time** | Latency is < 2 seconds (Real-Time stage advantage) |

### Failure Indicators

| Symptom | Likely Cause | Action |
|---------|--------------|--------|
| Host: Red error screen on "Go Live" | Backend unreachable or auth failed | Check WiFi, backend logs |
| Host: Camera preview but no live | Native stage join failed | Check Cognito token, stage ARN |
| Viewer: Black screen / spinner | Real-Time join failed | Check backend logs for `/api/live/join-realtime` |
| Viewer: No audio/video after join | Native viewer session didn't connect properly | Check Cognito token, connectionState logs |
| Both: "API base URL not configured" | EXPO_PUBLIC_LIVE_SERVICE_URL missing | Verify `.env.development` saved correctly |

---

## 📊 Backend Logs to Monitor

Keep the backend terminal visible. You should see logs like:

```
[LIVE_API][START_HOST_LIVE] { title: 'My Stream' }
POST /api/live/start
Response status: 200
Response: {"sessionId":"...", "stageArn":"...", "token":"..."}

[LIVE_API][JOIN_LIVE_REALTIME] { sessionId: '...' }
POST /api/live/join-realtime
Response status: 200
Response: {"token":"...", "stageArn":"..."}
```

If you see 401/403 errors, Cognito token validation failed.  
If you see 500 errors, there's an issue with DynamoDB or IVS credentials.

---

## 🎯 After Testing

Once you've tested host + viewer, tell me:

1. **Did host go live?**
   - Yes / No
   - Any error text? (copy-paste error message)

2. **Did viewer see the stream?**
   - Yes / No
   - Any error text? (copy-paste error message)

3. **Latency observations?**
   - Very fast (< 1 sec)
   - Acceptable (1-3 sec)
   - Slow (> 3 sec)
   - N/A (failed to test)

---

## 🛠️ Quick Troubleshooting

### Host goes live but viewer can't see stream

1. Check host phone: is video actually being captured? (camera preview visible?)
2. Check backend logs for any errors on `/api/live/join-realtime`
3. Check viewer phone console for connection errors
4. Verify both phones are on same WiFi network

### App says "API not configured"

1. Open `.env.development`
2. Verify line exists: `EXPO_PUBLIC_LIVE_SERVICE_URL=http://192.168.1.236:4000`
3. Save file
4. Restart Metro (Ctrl+C, then `npm run start` again)
5. Close and reopen app

### Backend shows "listen EADDRINUSE" error

Port 4000 is already in use. Kill the old process:
```powershell
Stop-Process -Id (Get-NetTCPConnection -LocalPort 4000).OwningProcess -Force
# Then restart: npm run dev
```

---

## ✨ Next Phase (After Testing)

If testing succeeds:
- Add DynamoDB tables (blyp_live_sessions, blyp_live_guests) in AWS
- Test guest request/invite flow
- Run performance tests (latency, audio sync, etc.)
- Prepare for production deployment

If testing fails:
- Share exact error messages + logs
- We'll debug auth, network, or DynamoDB issues together

---

**You're ready to test! 🚀**
