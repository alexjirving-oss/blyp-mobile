# LIVE AUDIT REPORT (FORENSIC)
## 1) Symptom
- What exactly happens when pressing Go Live (crash / spinner / permission deny / API fail)
## 2) Resolved Config Truth
- LAN IP detected: 192.168.1.236
- EXPO_PUBLIC_API_BASE_URL (from env + resolver logic)
- Selected streaming backend (IVS vs HLS/legacy)
- Region/account identifiers presence (no secrets)
## 3) First Failure Point (must be evidence-backed)
- UI -> JS -> Network -> Backend -> AWS -> Native (identify the first broken link)
## 4) Evidence
- metro.log key lines
- backend/functions logs key lines
- android_logcat key stack traces (if present)
- exact failing URL + status code (if network)
- exact native exception + module/method (if crash)
## 5) Ranked Root Causes (Top 5)
Each with:
- Evidence line(s)
- Why it causes Go Live failure
- Minimal fix outline (NO code changes yet)
## 6) Fix Plan (minimal, ordered)
- Step-by-step patch plan with verification checks
## 7) Verification Checklist
- Host can go live
- Viewer can join
- No crash
- Key logs show success path
