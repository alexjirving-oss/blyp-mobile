# Device Test Playbook – Live Streaming (Task 27)

Purpose: Human-readable, repeatable first-run validation of the live streaming pipeline (broadcaster → viewer) using physical Android device (preferred) and/or emulator. This precedes automated rule test scripts.

---
## 0. Preconditions
- Feature flag build-time constant: true (code bundled)
- Remote Firestore flag `appConfig/streaming.enabled`: false (start hidden)
- Hardened Firestore & Storage rules already deployed
- Composite index for `liveStreams` ready (status = Ready)
- Test users created:
  - User A (Broadcaster)
  - User B (Viewer)
- Both devices signed into distinct accounts
- Network: Stable Wi-Fi (avoid LTE throttling for baseline latency measurement)
- App freshly installed or cache cleared (to avoid stale flag state)

Optional: Prepare a short scripted commentary (10–20 seconds) for latency perception test.

---
## 1. Local Override Activation (Broadcaster Device Only)
Goal: Enable UI for User A while global flag remains off.
1. On Broadcaster device, open debug console (if available) or temporary helper screen (if you exposed one) to call `setLocalOverride(true)` from `StreamingFeatureFlag`.
2. Cold restart app.
3. Confirm Go Live button now visible for User A only.
4. Leave Viewer device untouched (should NOT show streaming UI yet).

If no helper UI exists: temporarily set remote flag true, start broadcast, then immediately set it false again—accepting brief viewer exposure. Preferred: implement hidden dev toggle.

---
## 2. Start a Broadcast (User A)
1. Tap Go Live.
2. Grant camera & microphone permissions (first run).
3. Confirm preview shows local camera feed.
4. Start streaming → note timestamp T0.
5. Observe Firestore console:
   - liveStreams/{streamId} doc created with: status=active, ownerId=UserA, startedAt present.
   - segments subcollection begins receiving docs (if using metadata per segment) OR periodic updates.
6. Observe Storage console → `streams/{streamId}/segments/` files appear in chronological order.
7. Record first 3 segment object sizes & upload timestamps.

---
## 3. Viewer Preparation (User B)
1. Ensure Viewer app has NO local override.
2. Set remote flag enabled=true temporarily to expose live feed to general users.
3. Cold start Viewer app; open Home screen.
4. Confirm LiveStreamsFeed shows the active stream (thumbnail/title if implemented) within 10–30s.
5. Tap stream to enter viewing mode → note timestamp T1.

---
## 4. Latency & Continuity Measurement
1. At ~T1 have Broadcaster speak a distinct phrase "Latency Marker One" while holding up fingers.
2. Viewer notes when phrase + gesture observed (T2).
3. Wall-clock latency ≈ T2 - spoken moment (video capture may help precise measurement).
4. Target initial acceptable: < 6–8s for segmented HLS-like approach (stretch goal < 5s if segment duration small).
5. During 60s window observe:
   - Segment arrival continuity (no >2x segment duration gaps).
   - Viewer playback stalls (count occurrences; aim for 0 in first minute).

---
## 5. Field & Rule Integrity Checks
In Firestore console while stream active:
- Confirm no unexpected fields on liveStreams doc.
- Attempt manual console edit of immutable field (ownerId) → should DENY.
- Attempt to add unauthorized field (e.g., `hackField`) → DENY.
In Storage console:
- Attempt manual upload of non-allowed MIME (if console allows) to `streams/{streamId}/segments/bad.txt` → DENY.

(If console does not simulate DENY clearly, replicate via emulator script later.)

---
## 6. Viewer Interaction (If Features Present)
- Like button: press once; confirm Firestore likes subcollection doc appears with correct userId.
- Comment (if implemented): post short text → appears under comments subcollection.
- Verify counters on parent doc update within expected rule constraints.

---
## 7. Stream Termination (Broadcaster)
1. Stop broadcast via UI control.
2. Firestore: liveStreams/{streamId}.status should transition to `ended` (or archived). endedAt set.
3. Viewer client should:
   - Auto-exit or show "Stream Ended" state within one polling/refetch cycle.
4. Confirm no new segment files after termination timestamp + one full segment interval.

---
## 8. Remote Flag Safety Test
1. While no broadcast active, set remote flag enabled=false.
2. Cold start both devices:
   - Go Live button hidden (unless local override set on Broadcaster device).
3. Remove local override on Broadcaster; cold start; confirm hidden again.

---
## 9. Data Hygiene & Cleanup
- Delete test liveStreams doc OR mark as archived (depending on retention policy).
- Optionally purge Storage segment files to avoid cost (leave one set for auditing if desired).
- Log metrics & observations in change log template (see deployment doc Appendix C).

---
## 10. Success Criteria Checklist
| Criteria | Pass Condition | Result |
|----------|----------------|--------|
| Stream doc created | liveStreams doc exists with correct ownerId/status | |
| Segments uploading | At least 3 sequential segments present | |
| Viewer discovery | Stream visible in feed within 30s of start | |
| Playback start latency | Viewer playback begins < 5s after tapping | |
| Wall-clock end-to-end | Spoken phrase latency < 8s | |
| No unauthorized writes | Rule tests denied forbidden edits | |
| Termination state | status=ended & no new segments after stop | |
| Flag kill works | enabled=false hides UI after restart | |

Populate Result with PASS/FAIL and notes.

---
## 11. Logging Template
```
DATE: (UTC)
BROADCASTER UID:
VIEWER UID:
Stream ID:
Start T0:
Viewer Join T1:
Phrase Observed T2:
Latency (T2 - phrase time):
Segments Observed (count, avg size):
Playback Stalls (count):
Rule Negative Tests: (ownerId edit DENY, extra field DENY, bad mime DENY)
Termination Observed At:
Residual Segments After Stop (count after +30s):
Flag Toggle Verification: PASS/FAIL:
Notes / Anomalies:
Follow-up Actions:
```

---
## 12. Troubleshooting Quick Reference
| Symptom | Likely Cause | Action |
|---------|--------------|--------|
| Viewer never sees stream | Index not ready / flag false / query filter mismatch | Verify index state, remote flag, console query logs |
| High latency > 12s | Large segment duration / network constraint | Reduce segment size, inspect encoder config |
| Gaps in segments | Uploader throttled / device sleep | Keep screen awake, check background mode restrictions |
| DENY on valid segment writes | Rule path mismatch or missing metadata field | Inspect Security Rules simulator with exact path & auth | 
| UI still shows after disable | Cached flag / local override lingering | Clear override, reinstall app, confirm Firestore doc |

---
## 13. Next Steps After PASS
1. Proceed to implement automated Firestore & Storage rule test scripts (Tasks 20/21).
2. Expand test to 3–5 internal viewers simultaneously; watch segment latency & bandwidth.
3. Establish ongoing monitoring (cost, write throughput baseline).
4. Prepare Production & Play Store checklist (Task 28).

---
End of Playbook.
