# Live Streaming Fixes - Three Issues & Solutions

## Issue A: Firestore Composite Index Missing ❌ → ✅

**Symptom:**
```
FirebaseError: [code=failed-precondition]: The query requires an index. 
You can create it here: https://console.firebase.google.com/v1/b/...&create_composite=...
```

**Root Cause:** One of the liveStreams queries is using `where() + orderBy()` without a matching composite index.

**Fix:**
1. Run the app and trigger the error once (it's already happening in logs)
2. In Metro bundler terminal, find the clickable URL in the error message
3. Click the URL → Firebase Console opens with pre-filled index creation
4. Click "Create Index"
5. Wait 2-3 minutes for status to show "READY"
6. The query will then work

**Current Indexes Needed:**
```
Collection: liveStreams
Field 1: status (Ascending)
Field 2: lastHeartbeatAt (Descending)
```

---

## Issue B: Directory Shows Duplicate Entries ❌ → ✅

**Symptom:**
```
Every test run adds another entry to the live list
Shows 4 broadcasters when there should be 0-1
```

**Root Cause:** State accumulation - BUT code already looks correct!

**Current Code (LiveUsersTab.js line 20):**
```javascript
setLiveUsers(streams);  // ✅ This replaces, not appends
```

**Action:** 
- This is already fixed in the current code
- If still seeing duplicates, they're likely stale Firestore docs
- **Clean up:** Delete all old liveStreams docs in Firestore Console that have no recent heartbeat
- After cleanup, stale entries won't show (90-second grace window filters them out)

---

## Issue C: Viewer Screen Shows "Missing Video URI" ❌ → ✅

**Symptom:**
```
WARN  [UnifiedVideo] Missing video URI. Rendering fallback UI only.
Viewer segments show: Segment: -1 / Buffer: 0 / Playing: No
```

**Root Cause:** playbackUrl isn't being passed to UnifiedVideo

**Technical Flow (Currently Correct):**
1. ✅ Viewer navigates with streamId
2. ✅ LiveStreamViewer subscribes to stream doc via backend
3. ✅ Backend extracts playbackUrl from Firestore doc
4. ✅ LiveStreamViewer receives playbackUrl in snapshot
5. ✅ LiveStreamViewer passes uri={playbackUrl} to UnifiedVideo

**Why It's Empty:**
- playbackUrl is initialized as `null` when stream is created
- playbackUrl only gets set when FIRST SEGMENT UPLOADS
- If segment loop never actually uploads (see diagnostic logs), playbackUrl stays null

**What to Check:**
```
From your logs, look for:
✅ Segment ${segmentNumber} uploaded

If you DON'T see this, the segment loop is stopping too early.
Check the diagnostic log:
⏹️ Stopping segment loop: camera or stream unavailable 
{ hasCamera: true, isStreamingActive: true }

If BOTH are true, loop should work.
If either is false, loop stops before segment uploads.
```

**Fix Path:**
1. Create a test stream as host
2. Check Firestore doc for that streamId
3. Look at the `playbackUrl` field
4. If it's null or missing, segments didn't upload
5. If it's a URL, viewer should receive it and video should load
6. Once viewer receives playbackUrl, the UnifiedVideo warning should disappear

---

## Next Steps (Priority Order)

### 1. Create the Firestore Index (Required - blocks everything)
- Click the auto-generated link in the error
- Create the index
- Wait for READY status

### 2. Clean Firestore of Stale Docs (Recommended)
- Go to liveStreams collection in Firestore Console
- Delete any docs with very old lastHeartbeatAt or with status='ended'
- This prevents directory clutter

### 3. Verify Segment Upload → playbackUrl Flow
- Start a stream as host
- Watch logs for: `✅ Segment 0 uploaded`
- Check Firestore doc: should show playbackUrl as a .ts URL
- Open viewer: should log playbackUrl and UnifiedVideo should render

### 4. If Still Issues
- If playbackUrl never appears: segment upload is failing (check recordAsync permissions)
- If playbackUrl appears but video doesn't play: check UnifiedVideo HLS support
- If video plays but doesn't update: check segment buffer logic

---

## Success Criteria (All Should Be True)

✅ Directory shows exactly 1 stream when 1 is live (not duplicates)
✅ Directory clears to 0 when stream ends
✅ Tap card → viewer opens with no "Missing URI" warning
✅ Video plays from HLS URL
✅ Segment counter increases as new segments upload
✅ View count increases as viewers join

