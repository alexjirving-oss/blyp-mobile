# Live Directory Subscription Test - Dec 6, 2025

## Test Sequence

### Phase 1: Navigate to Live Users Tab (Empty State)
**Expected Logs:**
```
[LiveUsersTab] subscribing to live streams
[LIVE][DIRECTORY][SNAPSHOT] { count: 0, ids: [] }
[LiveUsersTab][DIRECTORY][SET_STREAMS] { count: 0, ids: [] }
```

**Expected UI:**
- Loading spinner briefly
- Empty state (should show "No one is live yet" or similar)

---

### Phase 2: Start a Stream as Host
**Expected Logs (Host):**
```
[STREAM][HLS][STREAM_START_SUCCESS] streamId=live_xxx
⏹️ Stopping segment loop: camera or stream unavailable { hasCamera: true, isStreamingActive: true }
[STREAM][HLS][SEGMENT_UPLOAD] n=0 downloadURL=https://...
```

**Expected Logs (Directory Tab):**
```
[LIVE][DIRECTORY][SNAPSHOT] { count: 1, ids: ["live_xxx"] }
[LiveUsersTab][DIRECTORY][SET_STREAMS] { count: 1, ids: ["live_xxx"] }
```

**Expected UI (Directory):**
- 1 stream card appears with your name/thumbnail
- Real-time updates as heartbeat maintains stream

---

### Phase 3: Verify Segment Loop Diagnostics
**Key Log:**
```
⏹️ Stopping segment loop: camera or stream unavailable { 
  hasCamera: true,        ← Camera is available
  isStreamingActive: true, ← isStreaming flag is set
  currentStreamId: live_xxx
}
```

**Meaning:**
- If BOTH are true: Loop is working correctly, will record segments
- If either is false: Loop stops, explains why no segments produced

---

### Phase 4: End Stream
**Expected Logs (Host):**
```
[STREAM][HLS][STREAM_END_SUCCESS] streamId=live_xxx
```

**Expected Logs (Directory Tab):**
```
[LIVE][DIRECTORY][SNAPSHOT] { count: 0, ids: [] }
[LiveUsersTab][DIRECTORY][SET_STREAMS] { count: 0, ids: [] }
```

**Expected UI:**
- Stream card disappears
- Back to empty state

---

## Success Criteria

✅ **All three logs match:**
- `[LIVE][DIRECTORY][SNAPSHOT]` shows count: X
- `[LiveUsersTab][DIRECTORY][SET_STREAMS]` shows exact same count + ids
- UI renders X stream cards

✅ **No crashes:**
- No "onChange is not a function" error
- No "onSnapshot" errors from Firestore

✅ **Real-time updates:**
- Directory updates immediately when stream starts
- Directory clears immediately when stream ends

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| No SNAPSHOT log | Query not running or Firestore index missing | Check Firestore composite index exists |
| SNAPSHOT but no SET_STREAMS | onChange not being called | Check LiveService.js guards onChange |
| SET_STREAMS but empty UI | FlatList not rendering | Check data prop and keyExtractor |
| Logs show count but UI shows nothing | Rendering conditional broken | Check LiveUsersTab render logic |
| "onChange is not a function" crash | Old wiring still in place | Verify LiveUsersTab passes { onChange } object |

---

## Current Status
- Metro bundler: ✅ Running
- App: ✅ Logged in
- Firebase: ✅ Initialized
- Firestore Index: ✅ Created
- Code patches: ✅ Applied
- Ready to test: ✅ YES
