# Live Streaming Rollback & Recovery Playbook
Option: Hybrid Modular (Core + Appendices)
Version: v1 (Task 16)

---
## CORE (Engineer-Focused Quick Rollback)

### 1. Purpose
Provide a fast, low-friction path to disable or revert the live streaming feature (HLS-like segmented system) if instability, security risk, compliance request, or cost spike occurs.

### 2. Rollback Layers (Fastest → Deepest)
| Layer | Action | ETA | Rebuild Needed | Blast Radius |
|-------|--------|-----|----------------|--------------|
| A | Remote Kill Switch (feature flag) | <1 min | No | Immediate hide UI + block new streams |
| B | Firestore Rules Patch (deny new writes) | 2–5 min | No | Stops new streams & segments, existing viewers may still read |
| C | Storage Rules Patch (deny segment uploads) | 2–5 min | No | Blocks segment ingestion; active streams fail gracefully |
| D | UI Hotfix (comment out buttons, conditional render) | 5–10 min | Requires OTA (Expo) or rebuild | Hides entry points |
| E | Full Revert (git rollback + redeploy rules + rebuild client) | 15–30 min | Yes | Restores pre-stream baseline |

### 3. Immediate Kill Switch
1. Open Firestore Console → `appConfig/streaming` document (create if absent).
2. Set `enabled: false`.
3. (Optional) Add `reason: "incident YYYY-MM-DD HH:mmZ"`.
4. Users: UI should hide Go Live within refresh / next navigation. If using optimistic sync, call `primeStreamingFlag()` early.

### 4. Hard Stop via Rules (Defense-in-Depth)
**Firestore Rule Snippet (Temporary Override)**
```
// Near top of liveStreams rules block
function streamingDisabled() { return false; } // force false
// Replace previous check like: allow create: if isStreamOwner() && !streamingDisabled();
```
OR add a global constant-like function returning a boolean flag referencing a config doc (if you embed logic).

**Storage Rule Patch** (deny uploads to segments only):
```
match /streams/{streamId}/segments/{file} {
  allow write: if false; // temporary lockdown
  allow read: if true;   // keep playback working
}
```
Revert after recovery.

### 5. Backup & Restore (Rules & Code)
| Asset | Backup Method | Restore Command |
|-------|---------------|-----------------|
| Firestore Rules | `firebase firestore:rules:get > firestore.backup.rules` | `firebase deploy --only firestore:rules` |
| Storage Rules | `firebase storage:rules:get > storage.backup.rules` | `firebase deploy --only storage` |
| Index Config | Copy `firestore.indexes.json` | `firebase deploy --only firestore:indexes` |
| Code (Git) | `git tag pre-stream-launch` | `git checkout pre-stream-launch` |

### 6. Minimal Rollback Procedure (If Incident)
1. Trigger Kill Switch (Section 3).
2. Announce internal channel: "Live streaming paused — reason — next update in 15m".
3. Patch Firestore/Storage rules if active exploit or runaway cost.
4. Assess: error logs, cost graphs, segment backlog, security concerns.
5. Decide: hotfix vs revert commit.
6. Document root cause stub (create `incidents/INCIDENT-<date>.md`).
7. Resume feature: revert rules, set feature flag true, announce resolution.

### 7. Validation After Rollback
- Go Live button hidden? YES
- Attempts to create new stream rejected? YES
- Existing ended stream docs still readable? YES
- Storage segment uploads failing as expected (HTTP 403)? YES (if Storage locked)

### 8. Re-Enable Checklist
| Check | Done |
|-------|------|
| Root cause understood |  |
| Mitigation patch merged |  |
| Rules restored |  |
| Feature flag set true |  |
| Test broadcaster success |  |
| Viewer playback normal |  |
| Monitoring quiet (no error spikes) |  |

---
## APPENDIX A: Operational & Communication Layer

### A1. Stakeholders
| Role | Contact | Responsibility |
|------|---------|----------------|
| Engineering Lead | (fill) | Approves kill switch activation |
| Mobile Dev | (fill) | Applies code/UI hotfix |
| Backend/Firebase | (fill) | Modifies rules, monitors Firestore ops |
| Support / Community | (fill) | User messaging |

### A2. Internal Comms Templates
**Initial Notice (Slack)**
> :rotating_light: Live Streaming Temporarily Disabled. Reason: elevated Storage write failures. Next update in 15m.

**Resolution**
> :white_check_mark: Live Streaming Restored. Root cause: mis-sized segment causing retries. Mitigation deployed. Monitoring for 1h.

### A3. External/User Messaging (Optional)
Short in-app banner (if system exists):
> Live streaming is undergoing maintenance, please check back soon.

### A4. Incident Severity Table
| Severity | Trigger | Example |
|----------|---------|---------|
| SEV1 | Data exfiltration risk | Unauth edits to streams |
| SEV2 | Feature-wide outage | All segments failing upload |
| SEV3 | Degraded performance | Latency > 15s sustained |
| SEV4 | Minor inconsistency | Occasional like counter mismatch |

Action Escalation: SEV1 = immediate kill switch + rules lockdown. SEV2 = kill switch. SEV3 = monitor + partial mitigation. SEV4 = backlog issue ticket.

---
## APPENDIX B: Scenario Matrix & Decision Guides

| Scenario | Detection Signal | Fast Containment | Root Cause Clues | Longer-Term Fix |
|----------|------------------|------------------|------------------|-----------------|
| Cost Spike (Firestore) | Writes/min doubles | Kill switch if > budget | Segment duplication, retry storms | Batch writes, reduce metadata frequency |
| Storage Egress Surge | Sudden GB/hour rise | Limit viewer promotion | Aggressive polling by client | Add caching, reduce update freq |
| High Latency (>8s) | Viewer stopwatch tests | Inspect segment size | Large segment duration, network uplink | Adjust segment target length |
| Missing Segments | Playback stutter | Check storage list gaps | Upload failure/retry exhaustion | Add exponential backoff visibility |
| Likes Overcounting | likeCount drift | Disable likes temporarily | Duplicate doc creation | Enforce uniqueness rule refinement |
| Unauthorized Mutations | Rule deny logs | Lock rules to read-only | Misapplied allow update predicate | Re-audit field allow list |
| Global Playback Fail | 403s in logs | Storage rule review | Path mismatch or token expiration | Expand allowed MIME or adjust path logic |

### B1. Decision Flow (Textual)
1. Is user data at risk? → YES = Kill switch + lockdown (Sections 3–4) → Start SEV1 process.
2. Is feature unusable for majority? → YES = Kill switch; collect logs.
3. Is issue performance-only? → Keep feature on; log metrics; schedule fix.
4. After mitigation deployed → Gradually re-enable (flag true) → Monitor 15–30 min.

---
## APPENDIX C: Implementing a Firestore-Driven Kill Switch
Document already implemented in `src/config/StreamingFeatureFlag.js`.

**Firestore Doc Structure**
```
appConfig/streaming {
  enabled: true,
  reason: "initial launch",
  updatedAt: <serverTimestamp>
}
```

**Sample Firestore Console Script (Web snippet)**
```js
await setDoc(doc(db, 'appConfig', 'streaming'), {
  enabled: false,
  reason: 'temporary disable - incident 2025-10-07',
  updatedAt: serverTimestamp()
});
```

---
## APPENDIX D: Future Hardening Ideas
| Idea | Benefit |
|------|---------|
| Remote Config instead of Firestore | Lower read frequency, built-in caching |
| Circuit breaker for repeated upload failures | Automatic pause before cost blowout |
| Observability dashboard (BigQuery exports) | Faster anomaly detection |
| Automated segment-count integrity cron | Detect mismatches early |
| Rate limit viewer join events | Prevent bot flooding |

---
## APPENDIX E: Audit & Forensics
Minimal fields to snapshot during SEV1:
- Affected stream IDs
- Timestamps of abnormal mutations
- Auth UIDs involved
- SegmentCount vs actual segment file list
- Cost deltas (Firestore writes, Storage egress)

Store in: `incidents/INCIDENT-<date>.md`

---
## APPENDIX F: Checklist Summaries
**1-Minute Kill Switch**
- [ ] Set feature flag false
- [ ] Post Slack notice
- [ ] (Optional) Patch Firestore rule to deny create
- [ ] Verify UI hidden on test device

**5-Minute Deep Freeze**
- [ ] Deny Storage segment writes
- [ ] Backup current rules locally
- [ ] Capture initial logs & metrics

**30-Minute Recovery**
- [ ] Identify root cause
- [ ] Patch & test in staging/emulator
- [ ] Restore rules + flag
- [ ] Announce resolution + monitoring window

---
## APPENDIX G: Quick Commands Reference
```bash
# Backup rules
firebase firestore:rules:get > firestore.backup.rules
firebase storage:rules:get > storage.backup.rules

# Deploy specific rules
firebase deploy --only firestore:rules
firebase deploy --only storage:rules

# Deploy indexes only
firebase deploy --only firestore:indexes

# Tag current code state
git tag livestream-release-1

# Revert to pre-launch tag
git checkout pre-stream-launch

# Create / update kill switch doc (Node script idea)
node -e "(async()=>{const {initializeApp}=require('firebase/app'); /* ... */})();"
```

---
## APPENDIX H: Known Safe Baseline Definition
| Component | Baseline Description |
|-----------|----------------------|
| Firestore Rules | Hardened rule set without emergency denies |
| Storage Rules | Segment path writes allowed, MIME filtered |
| Feature Flag | enabled=true |
| Indexes | liveStreams composite present |
| UI | Go Live + feed visible |

---
##  END OF DOCUMENT
