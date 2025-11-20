# Live Streaming Verification & Testing Guide

Status: Draft v1 (Task 15)
Scope: Validate end-to-end functionality, security posture, performance, and cost safety of the HLS-like segmented live streaming feature prior to production enablement.

---
## 1. Objectives
1. Confirm broadcaster → segment generation → Storage upload → Firestore metadata update pipeline works reliably.
2. Confirm viewers see active streams list (indexed query) and can start playback within 3–5s latency target.
3. Validate Firestore & Storage security rules enforce intended access and mutation constraints.
4. Ensure counters (likes, views) behave idempotently and no privilege escalation is possible.
5. Gather baseline performance & cost signals for stream duration (5–10 min test).

---
## 2. Pre-Requisites Checklist
| Item | Required | Notes |
|------|----------|-------|
| Updated Firestore rules (hardened) | Yes | Deployed or loaded into emulator. |
| Updated Storage rules (stream paths) | Yes | Enforcing size/type & path scoping. |
| Composite index (status, type, startedAt) | Yes | Streams list feed queries faster. |
| Dev client installed | Yes | Needed for camera/mic streaming performance. |
| Test accounts (Broadcaster & Viewer) | Recommended | Use two devices if possible. |
| Stable network | Yes | Avoid Wi‑Fi handoffs during test. |
| Expo dev server stable | Yes | No auto restarts; caches cleared earlier. |

---
## 3. Data Model Quick Reference
Firestore Collections:
- `liveStreams/{streamId}`
  - Core fields: `userId`, `userDisplayName`, `status`, `title`, `createdAt`, `startedAt`, `endedAt`, `segmentCount`, `latestSegmentPath`, `viewCount`, `likeCount`, `thumbnailUrl`, `type` ("live"), `visibility`.
- Subcollections:
  - `liveStreams/{streamId}/segments/{segmentId}`: metadata per segment (duration, order, storagePath)
  - `liveStreams/{streamId}/likes/{userId}`: single doc per user (allows counting via security-enforced upsert)
  - `liveStreams/{streamId}/viewers/{viewerId}`: optional ephemeral tracking
  - `liveStreams/{streamId}/comments/{commentId}` (if integrated)

Storage Paths:
- `streams/{streamId}/segments/segment_<n>.mp4`
- `streams/{streamId}/thumbnails/preview.jpg`

---
## 4. Test Matrix Overview
| Domain | Test | Purpose | Success Criteria |
|--------|------|---------|------------------|
| Broadcaster Flow | Start Stream | Ensure document + initial state created | Firestore doc present with status="live" and segmentCount=0..1 |
| Segmentation | Segments Rolling | Confirm sequential uploads and metadata updates | Increasing segmentCount; latestSegmentPath updates |
| Viewer Discovery | Active Feed | Query returns stream quickly | Appears in feed within <5s of start |
| Playback | Start Viewing | Latency measurement | Playback begins within 3–5s of broadcast wall clock |
| Likes | Continuous Likes | Idempotent & count increments once per user | likeCount increments once; duplicate like blocked |
| Views | View Count | Only increments once per viewer session | viewCount stable after initial increment |
| End Stream | Graceful End | Final doc sealed, no new segments | status="ended"; endedAt set; no segment writes succeed |
| Security | Unauthorized Writes | Prevent non-owner updates | Non-owner update attempt denied |
| Security | Path Escapes | Prevent cross-stream writes | Write to other stream’s segments path denied |
| Performance | Segment Upload Rate | Sustainable cadence | Segment interval stable (e.g., every 2–6s) |
| Cost | Firestore Ops / min | Within acceptable baseline | Document writes < expected budget threshold |

---
## 5. Detailed Step-by-Step Validation
### 5.1 Firestore & Storage Rule Smoke (Optional Emulator First)
1. Start emulators (if using):
   ```bash
   firebase emulators:start --only firestore,storage --import=./seed --export-on-exit=./seed
   ```
2. Run planned rule test script (once created) to confirm allow/deny matrix.
3. Proceed to real project only after script passes.

### 5.2 Start a Stream (Broadcaster Device)
1. Login as Broadcaster test user.
2. Navigate to Profile → tap Go Live.
3. Enter a title (e.g., "Test Stream #1").
4. Start broadcast.
5. Observe console logs (if attached): should show initial Firestore write + first segment upload.
6. In Firestore Console: locate `liveStreams` doc → verify fields:
   - `status: "live"`
   - `segmentCount >= 0`
   - `startedAt` populated (serverTimestamp after resolve)

### 5.3 Verify Segment Generation
1. In Firebase Storage Console: open `streams/{streamId}/segments/`.
2. Confirm rolling files: `segment_0.mp4`, `segment_1.mp4`, etc.
3. Check file sizes: not zero bytes; consistent order of creation.
4. In Firestore: `segmentCount` increments in near real-time.

### 5.4 Viewer Discovery & Playback
1. On Viewer device (different account): open Home.
2. Ensure Live Streams feed displays the active stream card.
3. Tap to view: playback should begin. Start stopwatch when Broadcaster says a verbal marker (e.g., "MARK ONE").
4. Latency: difference between REAL TIME marker utterance and viewer hearing it.
   - Record: Acceptable 3–5s (prototype). >8s → investigate network or buffering configuration.

### 5.5 Likes & Views
1. Viewer taps like repeatedly → only first increments `likeCount`.
2. Firestore doc: `likeCount` increments by 1.
3. Viewer exits and re-enters: `viewCount` should not increment repeatedly (if logic supports session gating). If increments each entry, note for later optimization.

### 5.6 Error Handling Checks
1. Temporarily disable network on Broadcaster for ~10s.
2. Re-enable: segments should resume; no duplicate numbering gaps (unless design allows gap skip).
3. Confirm no crash; error logging captured (ErrorMonitoringService).

### 5.7 Ending the Stream
1. Broadcaster taps End Stream.
2. Firestore doc updates: `status="ended"`, `endedAt` timestamp.
3. Attempt to like again from viewer: allowed (if design permits), but no new segments appear.
4. Refresh Active feed: stream disappears (or appears with ended state if historical listing supported).

### 5.8 Security Negative Tests (Manual Console / Script)
| Attempt | Method | Expected Result |
|---------|-------|-----------------|
| Non-owner updates title | Firestore doc edit | DENIED |
| Non-owner writes new segment doc | Firestore segments subcollection | DENIED |
| Non-owner deletes segment | Firestore | DENIED |
| Write file to another streamId path | Storage upload console | DENIED |
| Upload unsupported MIME (e.g., .zip) | Storage | DENIED |
| Oversized segment (simulate upload > size cap) | Storage | DENIED |

### 5.9 Performance & Cost Snapshot
During a 5–10 min stream capture:
- Firestore writes/min (segments + doc updates): track approximate count.
- Storage egress (viewer playback) — evaluate after multiple viewers (optional).
- If possible, export usage graph screenshot after test (for internal review).

### 5.10 Post-Test Clean Up
1. Delete test stream doc & associated Storage folder (if desired) to reduce noise.
2. Review logs for unhandled exceptions.
3. Document latency, segment interval average, any anomalies.

---
## 6. Metrics & Thresholds (Initial Targets)
| Metric | Target | Notes |
|--------|--------|-------|
| Startup latency | < 5s | Broadcaster start → feed visibility |
| Playback latency | 3–5s | HLS-like segment pipeline baseline |
| Segment interval consistency | 80% within ±1s of target | If target = 4s segments |
| Error rate | 0 blocking errors | Non-fatal retries allowed |
| Firestore write throughput | < 60 writes/min | Rough cost control baseline |
| Storage rejection rate | 0% valid uploads | All segment uploads succeed |

---
## 7. Troubleshooting Decision Tree
| Symptom | Likely Cause | Action |
|---------|--------------|--------|
| No active stream appears | Index missing / query filter mismatch | Verify composite index; check `status` field value |
| Segments stop uploading | Network hiccup / unhandled promise | Check broadcaster logs; verify retry logic |
| Viewer latency >8s | Large buffer / slow segment upload | Inspect segment duration; measure upload time vs encode time |
| Likes duplicate increments | Missing uniqueness enforcement | Check likes subcollection security + client gating |
| 403 on segment upload | Storage rule mismatch | Confirm path pattern & MIME type |
| Non-owner can edit stream | Rule misconfiguration | Re-review field allow list & request.auth.uid checks |

---
## 8. Automation Hooks (Future)
- CI step: Run Firestore emulator + test script before merging rule changes.
- Telemetry capture: Add lightweight analytics event for segment upload duration & viewer join latency.
- Scheduled integrity job: Cross-verify segmentCount vs actual Storage file count.

---
## 9. Sign-Off Checklist
| Item | Done? |
|------|-------|
| Stream starts & visible in feed |  |
| Segments sequence correctly |  |
| Viewer latency measured & acceptable |  |
| Like & view logic validated |  |
| Unauthorized mutation attempts denied |  |
| End stream transition clean |  |
| Metrics recorded (latency, writes/min) |  |
| Cleanup performed |  |

---
## 10. Approval & Next Step
Once all boxes are checked with acceptable values, proceed to:
1. Deploy final rules (if using emulator prior). 
2. Run automated rule tests in CI. 
3. Move to production readiness tasks (Tasks 26–28, 33–35).

---
## 11. Appendix: Suggested Manual Console Queries
Firestore Console Filter (Active Streams):
```
Collection: liveStreams
Where: status == "live"
Order: startedAt desc
Limit: 20
```

Segment Count Consistency Quick Script (Node snippet Idea):
```js
// Pseudocode
const stream = await getDoc(doc(db, 'liveStreams', id));
const segs = await getDocs(collection(db, 'liveStreams', id, 'segments'));
if (segs.size !== stream.data().segmentCount) {
  console.warn('Mismatch segmentCount vs docs');
}
```

---
End of Document.
