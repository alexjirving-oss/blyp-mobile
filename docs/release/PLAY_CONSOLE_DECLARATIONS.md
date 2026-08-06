# Play Console declarations (FGS + full-screen intent)

Packet note for Blyp Android (`com.blyp.mobile`). Source of truth: native call stack under `android/app/src/main/java/com/blyp/mobile/calls/` plus `app.config.js` / `AndroidManifest.xml`.

## Summary

| Permission | Keep? | Play category to select |
|------------|-------|-------------------------|
| `FOREGROUND_SERVICE_MEDIA_PLAYBACK` | **Yes** | **Media playback** |
| `FOREGROUND_SERVICE_MICROPHONE` | **Removed** (next AAB) | N/A — should not appear after this build |
| `USE_FULL_SCREEN_INTENT` | **Yes** | **Calls** |

Do **not** invent games / marble-racing justifications. These permissions are for **messenger-style incoming audio/video calls** only.

---

## 1. `FOREGROUND_SERVICE_MEDIA_PLAYBACK`

**Checkbox:** Media playback

**Pasteable justification:**

> Blyp uses a short-lived foreground service (`IncomingCallForegroundService`, type `mediaPlayback`) to play the incoming-call ringtone after an FCM wake while the process would otherwise be killed. The service plays notification ringtone audio only; it does not capture microphone audio. It stops when the call is answered, declined, or times out.

**Evidence in app:**
- `AndroidManifest.xml` → `IncomingCallForegroundService` with `android:foregroundServiceType="mediaPlayback"`
- `IncomingCallForegroundService.kt` → `FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK` + `MediaPlayer` ringtone

---

## 2. `FOREGROUND_SERVICE_MICROPHONE`

**Status:** Over-declared historically; **removed** from `app.config.js` and blocked with `tools:node="remove"` in `AndroidManifest.xml`.

**Why removed:** No service declares `foregroundServiceType="microphone"`. The incoming-call FGS deliberately uses `mediaPlayback` because a microphone-typed FGS is killed on API 34+ when the mic is not actively capturing. In-call mic capture uses normal `RECORD_AUDIO` / WebRTC while the call UI is active — not a microphone FGS.

If Play still shows this declaration for an **older** AAB already uploaded, answer from that older build’s manifest, or upload the new AAB that drops the permission.

---

## 3. `USE_FULL_SCREEN_INTENT`

**Checkbox:** Calls

**Pasteable justification:**

> Blyp shows a full-screen incoming-call UI (`IncomingCallActivity`) when a user receives a Blyp audio/video call while the device is locked or the app is in the background. Notifications use `CATEGORY_CALL` / CallStyle with Answer and Decline actions and `setFullScreenIntent` so the ringing screen can appear over the lock screen, similar to other messaging/calling apps. Not used for alarms or promotional content.

**Evidence in app:**
- `IncomingCallModule.kt` → `setFullScreenIntent(...)`, `CATEGORY_CALL`, CallStyle
- `IncomingCallActivity` with `showWhenLocked` / `turnScreenOn`
- `ensureFullScreenIntentPermission` for Android 14+ user grant

---

## What remains in the next upload AAB

Expected declared sensitive permissions related to this questionnaire:
- `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_MEDIA_PLAYBACK`
- `USE_FULL_SCREEN_INTENT`
- `RECORD_AUDIO` (separate mic runtime permission for in-call / recording — not an FGS type declaration)

## Android 15 — Restricted foreground service types / BOOT_COMPLETED

**Issue:** Play flags apps that combine `BOOT_COMPLETED` receivers with restricted FGS types (`mediaPlayback`, etc.). On API 35 those boot→FGS starts throw `ForegroundServiceStartNotAllowedException`.

**Root cause:** `expo-notifications` merges `NotificationsService` with `BOOT_COMPLETED` (alarm re-arm only) while Blyp declares `IncomingCallForegroundService` (`mediaPlayback`) for FCM-woken call ringtones.

**Fix (versionCode ≥ 2026313239):**
- Manifest `tools:node="replace"` on `NotificationsService` — keep `NOTIFICATION_EVENT` + `MY_PACKAGE_REPLACED`, strip boot/reboot/quickboot.
- `RECEIVE_BOOT_COMPLETED` + unused `SYSTEM_ALERT_WINDOW` removed via `tools:node="remove"`.
- Plugin `plugins/withAndroid15BootFgsCompliance.js` keeps prebuild aligned.
- Incoming-call FGS still starts from FCM / user call UI only — never from boot.
- Local reminders re-arm on app open via `ensureRemindersArmed` (AlarmManager does not survive reboot without boot receivers).
