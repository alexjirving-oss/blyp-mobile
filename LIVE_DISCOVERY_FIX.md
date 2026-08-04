# Live User Discovery Bug Fix

## Problem Summary
Live streaming worked on the host device (Device 1) but the stream didn't appear in the Live Users tab on the viewer device (Device 2).

## Root Cause Analysis

### The Architecture
1. **Host starts streaming** → calls `HLSLiveStreamService.createStream()`
2. **Viewer looks for live users** → `LiveUsersTab` uses `subscribeToLiveUsers()`
3. **Discovery query** → `subscribeToLiveUsers()` queries `db.collection("users").where("status", "==", "live")`

### The Bug
**`HLSLiveStreamService.createStream()` only updated `userProfiles` collection, NOT `users` collection!**

```javascript
// OLD CODE (WRONG):
await db.collection('userProfiles').doc(userId).set({
  isLive: true,
  currentStreamId: streamId,
  lastStreamStarted: serverTimestamp()
}, { merge: true });

// Missing: Update to users collection that subscribeToLiveUsers() queries!
```

**Result:** 
- Host's `userProfiles/{userId}` had `isLive: true` ✅
- Host's `users/{userId}` had `status: 'offline'` or didn't exist ❌
- Viewer's query `users.where("status", "==", "live")` returned empty array ❌

## The Fix

### File Modified
`src/services/HLSLiveStreamService.js`

### Changes Made

#### 1. In `createStream()` method (after line ~148)
Added users collection update to make host discoverable:

```javascript
// Update users collection for live discovery (CRITICAL for LiveUsersTab)
try {
  await db.collection('users').doc(userId).set({
    status: 'live',
    currentStreamId: streamId,
    displayName: userDisplayName || 'Anonymous User',
    photoURL: userPhotoURL || null,
    lastActive: serverTimestamp()
  }, { merge: true });
  console.log('✅ User status updated in users collection - now discoverable in Live Users tab');
} catch (usersError) {
  console.error('❌ Error updating users collection:', usersError);
  // Continue anyway - stream creation is more important
}
```

#### 2. In `endStream()` method (after line ~599)
Added users collection cleanup to remove host from live list:

```javascript
// Update users collection to remove from live discovery
try {
  await db.collection('users').doc(userId).set({
    status: 'offline',
    currentStreamId: null,
    lastActive: serverTimestamp()
  }, { merge: true });
  console.log('✅ User status cleared in users collection - removed from Live Users tab');
} catch (usersError) {
  console.error('❌ Error clearing users collection:', usersError);
  // Continue anyway
}
```

## Expected Behavior After Fix

### When Host Starts Streaming (Device 1):
1. ✅ `liveStreams/{streamId}` document created with stream data
2. ✅ `userProfiles/{userId}` updated with `isLive: true`
3. ✅ **`users/{userId}` updated with `status: 'live'`** ← NEW!
4. ✅ Console logs: "✅ User status updated in users collection - now discoverable in Live Users tab"

### When Viewer Opens Live Users Tab (Device 2):
1. ✅ `subscribeToLiveUsers()` queries `users.where("status", "==", "live")`
2. ✅ Query returns host's user document
3. ✅ LiveUsersTab displays host in the list with name, photo, and stream ID
4. ✅ Viewer can tap to join the stream

### When Host Ends Stream (Device 1):
1. ✅ `liveStreams/{streamId}` updated with `status: 'ended'`
2. ✅ `userProfiles/{userId}` updated with `isLive: false`
3. ✅ **`users/{userId}` updated with `status: 'offline'`** ← NEW!
4. ✅ Host disappears from all viewers' Live Users tabs in real-time

## Testing Instructions

### Test 1: Basic Discovery
1. Device 1 (Host): Open app → Camera → Go Live → Start Stream
2. Device 2 (Viewer): Open app → Chat/Games → Live tab
3. **Expected:** Host appears in the Live Users list within 1-2 seconds
4. Device 2: Tap on host → Should join the live stream

### Test 2: Real-time Updates
1. Device 1: Start stream (as above)
2. Device 2: Verify host appears in Live Users tab
3. Device 1: End stream
4. Device 2: **Expected:** Host disappears from Live Users list within 1-2 seconds

### Test 3: Multiple Hosts
1. Device 1 & 2: Both start streaming
2. Device 3 (Viewer): Open Live Users tab
3. **Expected:** Both hosts appear in the list
4. Device 1: End stream
5. Device 3: **Expected:** Only Device 2 remains in list

## Debug Logs to Watch

### On Host Device (when starting stream):
```
✅ Stream created: [streamId]
✅ User profile updated - marked as live
✅ User status updated in users collection - now discoverable in Live Users tab
```

### On Viewer Device (when opening Live Users tab):
```
📡 LiveUsersTab: Setting up live users subscription
📡 Live users snapshot: [Array with live users]
📊 LiveUsersTab: Received 1 live users
```

### On Host Device (when ending stream):
```
⏹️ Ending stream [streamId]...
✅ User profile updated - no longer live
✅ User status cleared in users collection - removed from Live Users tab
```

## Related Files
- `src/services/HLSLiveStreamService.js` - Stream creation/management (FIXED)
- `src/services/LiveService.js` - Live user discovery query
- `src/components/LiveUsersTab.js` - UI component displaying live users
- `src/screens/LiveStreamScreen.js` - Host streaming screen
- `firestore.rules` - Security rules (already has DEV-OPEN access to users collection)

## Firestore Collections Involved

### `users/{userId}`
- **Purpose:** User presence and status for real-time discovery
- **Key Fields:**
  - `status`: "live" | "offline" | "away"
  - `currentStreamId`: Reference to active stream
  - `displayName`: User's display name
  - `photoURL`: User's profile photo URL
  - `lastActive`: Timestamp of last activity

### `userProfiles/{userId}`
- **Purpose:** Extended user profile data (separate from presence)
- **Key Fields:**
  - `isLive`: Boolean flag
  - `currentStreamId`: Reference to active stream
  - `lastStreamStarted`: Timestamp

### `liveStreams/{streamId}`
- **Purpose:** Live stream metadata and segments
- **Key Fields:**
  - `userId`: Host user ID
  - `status`: "live" | "ended"
  - `segments`: Map of segment data
  - `viewCount`, `likes`, etc.

## Why This Bug Existed

The codebase has two parallel user collections:
1. **`users`** - For real-time presence and discovery (used by LiveUsersTab)
2. **`userProfiles`** - For extended profile data (used by other features)

When live streaming was implemented, only `userProfiles` was updated, but the discovery query was written against `users`. This created a disconnect where:
- Host thought they were live (userProfiles said so)
- Viewers couldn't find them (users collection wasn't updated)

## Prevention
To prevent similar bugs in the future:
1. Always check which collection a query is reading from
2. Ensure writes target the same collection as reads
3. Add integration tests for multi-device scenarios
4. Consider consolidating `users` and `userProfiles` if redundancy causes issues

## Status
✅ **FIXED** - Ready for testing on two physical devices
