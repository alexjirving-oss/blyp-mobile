# Live Streaming End-to-End Test - Step-by-Step Execution

**Status:** Metro bundler started with full logging to `metro-full.log`

---

## ✅ Step 0: Log Capture Setup (DONE)

```powershell
npx expo start --clear --dev-client 2>&1 | Tee-Object -FilePath .\metro-full.log
```

✅ Metro is running in background
✅ All logs are written to `metro-full.log` file
✅ Can search log file later with Ctrl+F

---

## 📋 Step 1: Trigger Firestore Index Error & Create Index

### 1.1 Open app on device and navigate to Live directory

- Launch app
- Log in as **alex** (or your host user)
- Go to **Live Users / Directory tab**
- Watch for red console error overlay

### 1.2 Get the Firestore URL from metro-full.log

When error appears:

1. Switch to VS Code
2. Open file: `metro-full.log` (in project root)
3. Press **Ctrl+F**
4. Search: `The query requires an index`
5. You'll see:

```
FirebaseError: [code=failed-precondition]: The query requires an index. 
You can create it here: https://console.firebase.google.com/v1/r/project/blyp-master/...&create_composite=...
```

6. **Copy the entire https://... URL**

### 1.3 Create the index in Firebase

1. Open Chrome/browser
2. **Paste the URL** you copied
3. Firebase Console opens directly to "Create composite index"
4. **DO NOT change any fields** - they're pre-filled
5. Click **Create Index**
6. Watch status bar: wait for "Enabled" / "Ready" (~2-3 minutes)
7. Once ready, the query is unblocked forever

**Done with Step 1** ✅

---

## 🧹 Step 2: Clean Firestore Stale Docs

### 2.1 Open Firebase Console

1. Go to: https://console.firebase.google.com
2. Select project: **BLYP MASTER**
3. Left sidebar: **Firestore Database**
4. Click **Data** tab

### 2.2 Delete all old liveStreams docs

1. In collections list, click **liveStreams**
2. You'll see a list of docs (IDs like `aHlHKWrtzCYZoBWSxWlG`, etc)
3. **Tick the checkbox at the top** to select all
4. Click **Delete documents**
5. Confirm delete
6. You want the collection to be **completely empty** before next test

**Done with Step 2** ✅

---

## 🎬 Step 3: End-to-End Test

### 3.1 Host starts stream (Device A - alex)

**On your host device:**

1. Log in as **alex**
2. Go to **Go Live**
3. Enter a title (e.g., "Test Stream 1")
4. Tap **Start Streaming**

**Watch logs (terminal or metro-full.log) for:**

```
✅ Segment 0 uploaded
✅ Segment 1 uploaded
✅ Segment 2 uploaded
...
```

If you see these, HLS pipeline is working. If not, segments are failing and we have a separate issue.

**Check Firestore:**

1. Open https://console.firebase.google.com
2. Firestore Database → Data
3. Click **liveStreams** collection
4. You should see **one new doc** (ID looks like `aHlHKWrtzCYZoBWSxWlG` or similar)
5. Click the doc to expand
6. Look for a field like:
   - `playbackUrl`
   - `hls.playbackUrl`
   - `hlsPlaybackUrl`
   
   It should contain a URL starting with `https://...` and ending in `.m3u8` or `.ts`

**If playbackUrl is missing:** The field isn't being written. We'll fix that next.

**If playbackUrl exists:** Continue to 3.2 ✅

---

### 3.2 Viewer opens directory (Device B - blyp/other user)

**On your viewer device:**

1. Log in as **blyp** (or your other test user)
2. Go to **Live Users / Directory tab**

**Watch logs for:**

```
[LIVE][DIRECTORY][SNAPSHOT] { count: 1, ids: ["aHlHKWrtzCYZoBWSxWlG"] }
[LiveUsersTab][DIRECTORY][SET_STREAMS] { count: 1, ids: ["aHlHKWrtzCYZoBWSxWlG"] }
```

**Check UI:**

- You should see **exactly ONE stream card** with alex's name
- If you see 2+ cards, the directory state is still appending (we'll fix `setLiveUsers`)
- If you see 0 cards, the index or query is still broken

**Expected:**
```
✅ count: 1
✅ One card visible
✅ No duplicates
```

---

### 3.3 Tap card → Viewer opens

**On viewer device:**

1. Tap the live stream card

**Watch logs for:**

```
[LIVE][ROUTE_PARAMS] { "hostDisplayName": "alex", "hostUid": "alex", "mode": "viewer", "streamId": "aHlHKWrtzCYZoBWSxWlG" }
[LIVE][MODE_RESOLVED] { ... "isViewer": true, "mode": "viewer" }
```

**Most important - look for:**

```
[LiveStreamViewer][PLAYBACK_URL] Received: { 
  playbackUrl: "https://...m3u8",
  status: "live",
  streamId: "aHlHKWrtzCYZoBWSxWlG"
}
```

**If you see this URL:** Video should start loading ✅

**If you see:**

```
[LiveStreamViewer][NO_PLAYBACK_URL] {
  streamId: "aHlHKWrtzCYZoBWSxWlG",
  status: "live",
  dataKeys: ["id", "hostUid", "status", "currentSegment", ...]
}
```

Then: playbackUrl field is missing from the Firestore doc. We'll fix the write path.

**Screen expectations:**

If playbackUrl is received:
```
Segment: 0/1/2...
Buffer: 1+
Playing: Yes
✅ Video should render
```

If playbackUrl is missing:
```
WARN  [UnifiedVideo] Missing video URI
Segment: -1
Buffer: 0
Playing: No
❌ Fallback UI shows
```

---

### 3.4 End stream → verify cleanup

**On host device:**

1. Tap **Stop Streaming** button

**Check Firestore:**

1. Refresh https://console.firebase.google.com/firestore
2. Click **liveStreams** collection
3. The doc should either:
   - Be **deleted** entirely, OR
   - Show `status: "ended"` instead of `status: "live"`

**Check directory (viewer):**

Logs should show:
```
[LIVE][DIRECTORY][SNAPSHOT] { count: 0, ids: [] }
[LiveUsersTab][DIRECTORY][SET_STREAMS] { count: 0, ids: [] }
```

UI should go empty (no stream cards).

---

## 📊 TL;DR Success Checklist

- [ ] Index created and shows "Enabled" in Firebase
- [ ] Firestore liveStreams collection is empty before test
- [ ] Host starts stream → segments upload (log shows "Segment 0 uploaded")
- [ ] Host stream doc has a `playbackUrl` field with a URL
- [ ] Directory shows count: 1 (not duplicates)
- [ ] Tap card → viewer logs show `[LiveStreamViewer][PLAYBACK_URL]` with a non-empty URL
- [ ] Video plays (not "Missing URI" warning)
- [ ] End stream → directory clears to count: 0

---

## 🐛 If Something Fails

### Directory shows count: 2+ (duplicates)
**Fix:** In LiveUsersTab.js line 20:
```javascript
// WRONG:
setLiveUsers(prev => [...prev, ...streams]);

// CORRECT:
setLiveUsers(streams || []);
```

### Playback URL is missing from Firestore doc
**Fix:** Check segment upload in HLSLiveStreamService.js line 289:
```javascript
// Should have:
playbackUrl: downloadURL,

// And check that segments are actually uploading (look for logs):
✅ Segment 0 uploaded
```

### Still getting "Missing video URI" after playbackUrl is present
**Issue:** UnifiedVideo component or URI prop name mismatch
**Next step:** Paste in:
1. The Firestore doc JSON
2. The [LiveStreamViewer][PLAYBACK_URL] log
3. We'll give you the exact one-line mapping

---

## 📝 When to Report Back

Once you complete 3.4, tell me:

1. **Index:** Created successfully? ✅ or ❌ (and what error if ❌)
2. **Firestore:** Cleaned? ✅
3. **Segments:** Did you see "Segment 0 uploaded"? ✅ or ❌
4. **Directory:** count: 1 (no duplicates)? ✅ or ❌
5. **Playback URL log:** Did you see the log with a URL value? ✅ or ❌ (if ❌, paste the exact log)
6. **Video:** Did it play? ✅ or ❌
7. **Cleanup:** Directory cleared after ending stream? ✅ or ❌

This will tell us exactly which piece is broken.
