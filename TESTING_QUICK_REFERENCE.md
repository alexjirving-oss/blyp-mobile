
# 🎯 Quick Reference: Testing Live Streaming

## Start Testing (Run This First)
```bash
npx expo start -c
```
> The `-c` flag clears cache to load new LiveService exports

---

## ✅ What Was Fixed

1. **Timer Stuck at Zero** → Added `setInterval` effect, updates every second
2. **Empty Live Tab** → Auto-create user profiles, track `currentStreamId`
3. **Header Overlap** → Added safe area insets to LiveUsersTab

---

## 🔍 Console Messages to Watch For

### When You Login:
```
✅ User profile ensured for: user123
```

### When You Start Stream (Device A):
```
✅ Stream created: abc123
✅ User status set to "live" in Firestore
⏱️ Starting timer interval
```

### When Viewer Opens Live Tab (Device B):
```
📡 LiveUsersTab: Setting up live users subscription
📊 LiveUsersTab: Received 1 live users
  User 1: {
    id: "user123",
    displayName: "Alex",
    photoURL: "yes",
    currentStreamId: "abc123",
    status: "live"
  }
```

### When You Stop Stream (Device A):
```
✅ Stream ended: abc123
✅ User status set to "offline"
⏱️ Clearing timer interval
```

---

## 🧪 2-Device Test Script

### Device A (Broadcaster):
1. Open app, log in
2. Go to Camera screen
3. Enter title: "Test Stream"
4. Press "Go Live"
5. **VERIFY:** Timer counts 00:01, 00:02, 00:03...
6. **VERIFY:** Console shows "✅ User status set to 'live'"

### Device B (Viewer):
1. Open app, log in
2. Go to Chat → Live tab
3. **VERIFY:** Device A appears in list
4. **VERIFY:** Name and avatar show correctly
5. **VERIFY:** No overlap with header
6. Tap the card
7. **VERIFY:** Navigates to stream view

### Device A (Stop):
1. Press X button to stop
2. **VERIFY:** Console shows "✅ Stream ended"

### Device B (Verify Cleanup):
1. **VERIFY:** Device A disappears from Live tab

---

## ❌ If Something Goes Wrong

### Timer Still at 00:00?
- Check console for `⏱️ Starting timer interval`
- If missing: Stream didn't start properly, check for errors
- If present: Restart app with `npx expo start -c`

### Live Tab Still Empty?
- Check broadcaster console for `✅ User status set to "live"`
- If missing: Stream creation failed, check errors
- If present: Check viewer console for `📊 LiveUsersTab: Received X users`
  - If "Received 0": Firestore query returning nothing
  - If "Received 1+": Data issue, check the logged user object

### "Missing or Insufficient Permissions"?
```bash
firebase deploy --only firestore:rules
```

### "Export not found" or "undefined is not a function"?
```bash
npx expo start -c
```
> Metro bundler cache issue, clear and restart

---

## 📂 Files That Were Changed

```
src/screens/LiveStreamScreen.js     → Timer + createStream/endStream
src/services/LiveService.js          → Stream tracking + ensureUserProfile
src/screens/AuthScreen.js            → Auto profile creation
src/components/LiveUsersTab.js       → Safe area padding + debug logs
```

---

## 🎯 Key Functions

| Function | Purpose | Called From |
|----------|---------|-------------|
| `createStream()` | Set user "live" + create stream doc | LiveStreamScreen.actuallyStartStream() |
| `endStream()` | Set user "offline" + end stream | LiveStreamScreen.stopStreaming() |
| `ensureUserProfile()` | Create user doc with displayName | AuthScreen.handleAuth() |
| `subscribeToLiveUsers()` | Real-time query for live users | LiveUsersTab.useEffect() |

---

## 🔥 Firebase Data Structure

### /users/{uid}
```json
{
  "displayName": "Alex",
  "email": "alex@example.com",
  "photoURL": "https://...",
  "status": "live",           ← "live" or "offline"
  "currentStreamId": "abc123", ← streamId when live, null when offline
  "updatedAt": Timestamp
}
```

### /streams/{streamId}
```json
{
  "hostUid": "user123",
  "title": "My Stream",
  "status": "live",           ← "live" or "ended"
  "viewerCount": 5,
  "thumbnailUrl": null,
  "createdAt": Timestamp,
  "endedAt": Timestamp        ← Only when ended
}
```

---

## 📱 Ready to Test!

1. Clear cache and restart: `npx expo start -c`
2. Open app on two devices
3. Follow the 2-Device Test Script above
4. Watch console logs for emoji markers
5. Report any issues with console output

Good luck! 🚀

