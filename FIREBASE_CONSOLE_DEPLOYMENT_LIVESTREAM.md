# Firebase Console Deployment Guide – Live Streaming Feature (Task 26)

Console-first runbook for safely deploying the Blyp Live Streaming backend changes (Firestore + Storage + Index + Feature Flag). Includes rollback hooks and CLI appendix for future automation.

---
## 0. Scope & Pre-Req Checklist
Confirm all preconditions are satisfied BEFORE modifying production:
- [ ] Hardened Firestore rules file ready (merged livestream sections)
- [ ] Hardened Storage rules file ready (streams path restrictions + MIME/size checks)
- [ ] Composite index (liveStreams: status+type+startedAt) defined or planned
- [ ] Feature flag module shipped in current app build (already in code)
- [ ] Rollback & recovery doc on hand (`ROLLBACK_AND_RECOVERY_LIVESTREAM.md`)
- [ ] Verification test matrix prepared (`VERIFICATION_TESTING_LIVESTREAM.md`)
- [ ] Current production rules exported & archived (Step 1)
- [ ] At least one admin test user available

Assumption: You will initially DEPLOY RULES with the feature flag defaulted OFF remotely (`enabled: false`) to allow a dark launch safety net.

---
## 1. Export & Archive Current Rules (Safety Snapshot)
Console (UI does not give raw text easily for Firestore rules). Use CLI for fidelity:
1. Ensure Firebase CLI installed & logged in.
2. Run (CLI) to capture existing rules locally before any change (see Appendix A for commands):
   - firestore.rules -> `backup/rules/firestore.<DATE>.rules`
   - storage.rules   -> `backup/rules/storage.<DATE>.rules`
3. Git add & commit these backups or store in secure artifact bucket.

If CLI unavailable now: copy/paste existing UI rule text manually into dated files (last resort, higher risk of transcription errors).

---
## 2. Firestore Rules Deployment (Console First)
1. Open Firebase Console → Firestore Database → Rules tab.
2. In your local repo open the merged hardened rules (the one that already includes `liveStreams` and its subcollections constraints). Verify:
   - Restricted write fields (no privilege escalation: owner immutable, createdAt server-side).
   - Subcollection path checks (segments, likes, comments) scoped to parent stream doc.
   - Validation on allowed fields (reject unexpected keys).
3. In the Console editor, replace existing content with the hardened rules.
4. Click Publish.
5. Observe the rules simulator quickly (optional sanity):
   - Attempt a read on `/liveStreams/TEST_ID` as unauthenticated (should Deny unless rule allows public read for active streams — follow your chosen policy).
   - Attempt an illegal write (e.g., add random field) – should Deny.
6. Leave tab open (fast rollback possible by re-pasting prior rules for ~5 minutes window).

---
## 3. Storage Rules Deployment (Console)
1. Firebase Console → Storage → Rules.
2. Replace rules with hardened version containing the `streams/{streamId}/segments/{file}` path guard.
3. Key checks to visually confirm before Publish:
   - Enforces authenticated user.
   - Verifies stream ownership or allowed write logic.
   - Limits file size and MIME types (e.g., video/mp4, video/MP2T, audio/aac as required by encoder).
   - Prevents path traversal (no nested subfolders beyond expected segments).
4. Publish.
5. Optional: Rules Playground quick write test using a non-owner uid → should Deny.

---
## 4. Composite Index Creation / Verification
1. Console → Firestore Database → Indexes → Composite.
2. Search for an index with collection `liveStreams` covering (status ASC, type ASC, startedAt DESC) (ordering may differ; ensure query compatibility with your feed code).
3. If missing: click Add Index →
   - Collection: `liveStreams`
   - Fields (example ordering):
     1. status Asc
     2. type Asc
     3. startedAt Desc
   - (Add any additional filters required by queries, e.g., visibility if used.)
4. Create. Note build time (a few minutes). Do NOT enable feature flag globally until status shows Ready.
5. Record index ID in a change log commit message or ops notes.

---
## 5. Create / Verify Remote Feature Flag Document
1. Console → Firestore Database → Data.
2. Create collection `appConfig` (if not existing).
3. Inside it create document ID `streaming`.
4. Fields:
   - enabled (Boolean): false (initial dark launch state)
   - reason (String, optional): "Initial deployment – verifying rules & indexes"
   - updatedAt (Server Timestamp) – set via console UI (Add field → choose timestamp if supported; else will be absent until first programmatic update).
5. Save.
6. Outcome: Mobile clients will still show streaming UI only if build-time constant true AND remote flag has not yet been fetched (briefly). After first fetch (within a minute or on cold start) UI hides (since enabled = false). This offers a stable test bed.

---
## 6. Post-Deployment Smoke Tests (Flag Off)
Goal: Ensure rules protect data before exposing feature.
1. Using an admin/test device with updated app build, cold start app → confirm Live UI hidden.
2. Manually attempt to craft invalid writes via temporary scripted test (or emulator) — expect Deny.
3. Upload a valid segment through broadcaster flow (if you temporarily set local override ON in dev) → Storage write should Allow; Firestore segment doc created.
4. Confirm that a non-owner user cannot write to segments or modify protected fields.
5. Read feed queries for live streams return empty or only test streams as expected.

---
## 7. Gradual Enablement (Turning Feature On)
1. Update `appConfig/streaming.enabled` → true for internal testers only WHEN:
   - Index READY.
   - All smoke tests passed.
   - Monitoring plan ready (Crashlytics / Logs / Firestore metrics).
2. Add or update `reason` field for audit trail.
3. Communicate go-live window to team.
4. Observe first 5 minutes: Firestore read/write error rates, Storage egress, client latency (per verification doc targets).
5. If anomalies: set enabled=false immediately (instant kill switch) and consult rollback doc.

---
## 8. Monitoring & Early Metrics
Track within first session:
- Firestore document write latency (target < 250ms p95 for segments metadata)
- Storage upload success rate ( > 99% initial small sample )
- App error logs (no unhandled exceptions in streaming modules)
- Cost watch: Firestore document writes per minute vs expected segment cadence
- Any rule-denied spikes (indicates client misuse or misconfig)

---
## 9. Rollback Paths (Summary)
Escalation ladder (fastest first):
1. Remote flag: enabled=false (immediate UI hide; existing uploads cease once components unmounted).
2. Temporary emergency rule tighten (deny all writes to `liveStreams` & `streams/*` paths) by short patch.
3. Full revert to archived rules & storage rules (use backups from Step 1).
4. Disable or roll back app version (store listing) if runaway clients continue (extreme scenario).

Full detail: see `ROLLBACK_AND_RECOVERY_LIVESTREAM.md`.

---
## 10. Audit & Documentation After Go-Live
Within 24h:
- Record timestamp of enablement & initial metrics snapshot
- Tag repository commit SHA associated with deployed rules
- Log any deviations from verification matrix & resolutions
- Capture cost baseline for monthly forecast adjustments

---
## 11. Common Pitfalls & Preventive Checks
| Pitfall | Prevention |
|--------|------------|
| Forgetting to create remote flag → feature unknowingly ON | Always create `appConfig/streaming` before rule deployment |
| Missing composite index causing slow queries | Verify index status BEFORE flipping flag |
| Upload MIME mismatch (encoder variant) | Add allowable MIME types explicitly; adjust rules not wildcard '*' |
| Overly permissive segment updates | Ensure rules only allow create + immutable fields or strictly validated updates |
| Flag caching confusion | Wait at least 60s or cold start app to reflect remote changes |

---
## 12. Ready-for-Production Completion Criteria
All must be TRUE:
- [ ] Hardened Firestore & Storage rules published and simulator spot-checks passed
- [ ] Composite index status = Ready
- [ ] Remote feature flag doc exists (enabled=false initially)
- [ ] Successful internal broadcast + view under test override, no violations
- [ ] Monitoring dashboard links documented
- [ ] Rollback assets (rule backups) stored & referenced
- [ ] Verification matrix items 1–10 marked Pass

---
## Appendix A: CLI Equivalents
Install & Auth:
```bash
npm install -g firebase-tools
firebase login
firebase use <YOUR_PROJECT_ID>
```

Export existing rules:
```bash
firebase firestore:rules:get > backup/rules/firestore.$(date +%Y%m%d-%H%M%S).rules
firebase storage:rules:get > backup/rules/storage.$(date +%Y%m%d-%H%M%S).rules
```

Deploy updated rules (from repo root if firebase.json references them):
```bash
firebase deploy --only firestore:rules,storage:rules
```

Deploy indexes (if editing `firestore.indexes.json`):
```bash
firebase firestore:indexes deploy
```

Emulator local test (optional pre-flight):
```bash
firebase emulators:start --only firestore,storage
```

Set remote flag (script example Node.js):
```js
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, serverTimestamp } from 'firebase/firestore';
const app = initializeApp({ /* config */ });
const db = getFirestore(app);
await setDoc(doc(db, 'appConfig', 'streaming'), { enabled: false, reason: 'Initial deploy', updatedAt: serverTimestamp() });
```

---
## Appendix B: Fast Validation Snippets (Emulator)
Firestore (node script pseudo):
```js
// Should deny unexpected field
await assertDenied(setDoc(doc(db, 'liveStreams', 'x'), { ownerId: uid, bogus: 1 }));
// Should allow valid minimal create
await assertAllow(setDoc(doc(db, 'liveStreams', 'x2'), { ownerId: uid, status: 'active', createdAt: serverTimestamp(), type: 'public' }));
```

Storage (segment upload pseudo):
```js
// Deny: wrong mime
await assertDenied(upload('streams/abc/segments/file.txt', 'text/plain'));
// Allow: valid .mp4 within size
await assertAllow(upload('streams/abc/segments/seg0.mp4', 'video/mp4'));
```

---
## Appendix C: Change Log Template
```
DATE/TIME (UTC):
Environment: production
Change: Deploy hardened Firestore & Storage rules + set remote flag false
Index Status: READY / BUILDING
Feature Flag: enabled=false
Verification Smoke Results:
  - Rule negative tests: PASS
  - Segment write: PASS
  - Feed query latency (first 5): < 300ms p95
Rollback Assets: firestore.<DATE>.rules, storage.<DATE>.rules
Notes:
```

---
## Appendix D: Rapid Troubleshooting Matrix
| Symptom | Likely Cause | Fast Action |
|---------|--------------|-------------|
| Clients still see Go Live after disable | Cached flag | Force app restart, confirm updatedAt on doc |
| Feed empty though stream active | Index building or query mismatch | Check index status & query filters |
| Segment writes denied for owner | Owner check logic or path mismatch | Validate path pattern & user UID context |
| High Firestore costs early | Excess polling/querying | Add client-side throttling / increase cache TTL |
| Uploads succeed but not listed | Firestore segment doc write failed | Inspect Firestore write error logs |

---
End of Guide.
