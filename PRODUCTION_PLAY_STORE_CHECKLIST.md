# Production & Play Store Checklist (Task 28)

Purpose: End-to-end operational + store readiness checklist for releasing Blyp Mobile with Live Streaming (gated by feature flag). This document assumes the device test playbook and automated rule tests have passed.

---
## 0. Release Gate Summary
| Gate | Criteria | Status |
|------|----------|--------|
| Security Rules | Hardened Firestore & Storage rules deployed & tests PASS | |
| Index Readiness | liveStreams composite index READY | |
| Feature Flag Kill-Switch | appConfig/streaming.enabled remotely toggleable | |
| Latency Benchmark | End-to-end phrase latency ≤ 8s (goal ≤ 6s) | |
| Stability Smoke | 1 full stream cycle no crashes/exceptions | |
| Storage Cost Baseline | Segment size within expected envelope | |
| Rollback Assets | Rule backups + kill switch doc on hand | |
| Monitoring Hooks | Firestore usage, Crashlytics (if integrated), Logs visible | |
| Privacy & Data Safety | Policy URL + Data Safety form prepared | |
| Store Assets | Icon, feature graphic, screenshots, short & full desc | |
| Versioning | app.json + eas.json version & buildNumber incremented | |
| QA Sign-off | Playbook log archived | |

Fill Status with PASS/FAIL/—.

---
## 1. Version & Build Configuration
1. Increment app version:
   - In `app.json` / `app.config` (if used): `version`, `android.versionCode`.
   - Ensure semantic version aligns with internal roadmap (e.g., 1.1.0 for first streaming release).
2. Validate release governance inputs:
   - Android release creation must run through `tools/release/BUILD_RELEASE_CANDIDATE.ps1`.
   - `eas.json` production values must not be treated as a direct Android build route.
3. Confirm no lingering dev-only env vars in production profile.
4. Commit changes: `git commit -m "chore: bump version for streaming release"`.

---
## 2. Feature Flag Launch Strategy
Strategy: Ship binary with streaming code bundled but remote flag disabled until post-submission validation.
Steps:
1. Before build: Set `BUILD_ENABLE_LIVE_STREAMING = true` (already true) so UI is ready if flag flips.
2. Ensure remote doc `appConfig/streaming.enabled = false` before releasing to public.
3. Post-internal testing (closed track) → flip to true for selected test cohort.
4. Monitor metrics (Section 8) → widen rollout.
5. Emergency disable: set enabled=false (≤ 60s propagation + cold start).

---
## 3. Firebase Security & Compliance
1. Run automated tests:
   - `npm run test:rules` (Firestore + Storage) → All ALLOW/DENY expectations PASS.
2. Manual high-risk attempts (optional):
   - Modify immutable fields (expect DENY)
   - Upload invalid MIME (DENY)
   - Write segment doc as non-owner (DENY)
3. Export final rules snapshot:
   - `firebase firestore:rules:get > backup/rules/firestore.release.rules`
   - `firebase storage:rules:get > backup/rules/storage.release.rules`
4. Archive in version control (tag commit).
5. Confirm Firestore usage alerts (billing threshold) configured.

---
## 4. Data Safety & Privacy
1. Draft / Update Privacy Policy (host on website or GitHub Pages) covering:
   - Data collected: email, profile media, stream content (ephemeral vs stored), likes/comments.
   - Purpose: social interaction & content sharing.
   - Third parties: Firebase (Auth, Firestore, Storage), Expo services.
   - Retention: segment retention duration / archival policy.
   - User rights & deletion requests procedure.
2. Google Play Data safety form mapping:
   - Data Collection: Personal info (email), User content (photos, video), Audio (stream mic), Diagnostics (crashes if enabled).
   - Data shared? Usually No (unless analytics/ads added later).
   - Security practices: Data in transit encrypted (HTTPS), access controlled by Firebase Auth + Security Rules.
3. Content Rating Questionnaire: answer regarding user-generated content (Yes), violence (No/Incidental), gambling (No), user communication (Yes – moderated by rules/policies).
4. Age rating: configure parental guidance if streaming not curated; outline moderation plan.

---
## 5. Store Listing Assets (Google Play)
Provide required sizes:
- App Icon: 512×512 (PNG) – ensure brand consistent.
- Feature Graphic: 1024×500.
- Screenshots (phone): Minimum 2; provide 6–8 showcasing feed, profile, camera, live stream viewer.
- Optional: Short promo video (YouTube) focusing on < 30s value pitch.
- Short Description: ≤ 80 chars – highlight streaming.
- Full Description: 3–6 paragraphs (keywords: live streaming, social, real-time video, Firebase powered).
- Category: Social / Video.
- Content rating & Data Safety forms completed.
- Privacy Policy URL added.

Draft copy suggestions:
Short: "Go live in seconds. Share real-time video, voice, and moments with your community."
Full (outline):
1. Hook: Instant mobile live streaming.
2. Features: Live video, voice memos, media posts, lightweight chat.
3. Reliability: Firebase-backed scalability & security.
4. Privacy: User-controlled data, secure rules.
5. Call to action.

---
## 6. Pre-Release Tracks & Testing
1. Create Internal Test Track (Google Play Console) – assign internal testers.
2. Upload the frozen AAB from `diagnostics/release_aab/CANONICAL_PLAY_AAB_<timestamp>/app-release.aab`.
3. Release notes (internal): focus on streaming test, flag is disabled by default.
4. After internal PASS → move to Closed Testing (invite early adopters).
5. Validate crash-free sessions (Crashlytics if integrated; otherwise JS error logs).

---
## 7. Monitoring & Observability
Metrics to watch immediately after flipping flag for a cohort:
- Firestore: document writes/min (segments, likes), read costs for feed queries.
- Storage: egress MB/min, object creation rate.
- Latency: measured via manual speech marker or instrumentation (future improvement: add client event logs collection).
- Errors: JavaScript exceptions, rule DENY spikes (Security Rules debug logs optional during early phase).
- User retention on stream viewer screen (session length > X seconds baseline).

Tooling Enhancements (Future):
- Add lightweight analytics event: `stream_segment_uploaded`, `stream_view_joined`, `stream_view_duration_ms`.
- Integrate Crashlytics / Sentry with release build.

---
## 8. Release Rollout Plan
1. Phase 0 (Internal Only): Flag false, validate startup and no phantom writes.
2. Phase 1 (Internal Test Track): Flag true for a single stream event (≤ 30 min). Monitor metrics.
3. Phase 2 (Closed Track 5–20 users): Expand viewers, measure latency variance, watch costs.
4. Phase 3 (Open Track / Production 5% rollout): Keep ability to revert quickly.
5. Phase 4 (100% Rollout): After 48h stable metrics & zero security incidents.

Rollback Ladder (fast → deep):
1. Flag disable.
2. Temporary rule patch (deny new liveStreams writes).
3. Revert rules snapshot.
4. Unpublish update (extreme) / push hotfix with BUILD_ENABLE_LIVE_STREAMING=false.

---
## 9. Risk Register & Mitigations
| Risk | Impact | Mitigation | Owner |
|------|--------|-----------|-------|
| High segment write rate cost spike | Elevated billing | Alert thresholds + cohort gating | Eng |
| Rule misconfiguration allows tamper | Data integrity | Automated rules tests pre-deploy | Eng |
| Latency too high on low-end devices | User churn | Tune segment duration, adaptive bitrate (future) | Eng |
| Abuse / inappropriate content | Brand risk | Add report endpoint + quick disable flag | Ops |
| Crash on permission denial | Onboarding friction | Guard camera/mic prompts & fallback UI | Eng |

---
## 10. Final Pre-Submission Checklist
| Item | Done? |
|------|-------|
| Incremented version & versionCode | |
| Canonical Android release build successful | |
| Bundle passes Play pre-launch report | |
| Privacy Policy URL live | |
| Data Safety form submitted | |
| Content rating questionnaire completed | |
| App icon + feature graphic uploaded | |
| Screenshots uploaded | |
| Short + full description finalized | |
| Remote flag = false at submission | |
| Automated rules tests PASS at submission commit | |
| Tag repo (v1.1.0-live-stream-ready) | |
| Rule backups archived | |

---
## 11. Post-Release Day 0 & 1 Tasks
Day 0 (After propagation):
- Validate installs & open rate in Play Console.
- Spot-check Firestore usage vs forecast.
- Confirm no spike in DENY logs beyond expected.

Day 1:
- Evaluate retention on streams (first session lengths).
- Decide whether to proceed to broader rollout (Phase 3 → Phase 4 criteria).
- Add any newly discovered edge cases to automated tests.

---
## 12. Documentation & Tagging
1. Create release notes: `RELEASE_NOTES_v1.1.0.md` summarizing features & risks.
2. Git tag: `git tag v1.1.0-live-stream` & push.
3. Link release tag to rule snapshots and test run logs.
4. Update root README streaming section with actual latency metrics from device test.

---
## 13. Future Hardening Backlog (Post-Launch)
- Adaptive bitrate or dynamic segment length.
- Viewer count aggregation optimization (server-side incremental updates).
- Automated screenshot detection / content moderation pipeline.
- CDN edge caching optimization if moving beyond Firebase defaults.
- Automated load test harness for 100+ concurrent viewers.

---
## 14. Quick Commands Reference
```bash
# Production build
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\release\BUILD_RELEASE_CANDIDATE.ps1 -ExpectedVersionCode <versionCode>

# Submit build to Play internal track
eas submit --platform android --profile production

# Run rules tests
npm run test:rules

# Export rules snapshots
firebase firestore:rules:get > backup/rules/firestore.release.rules
firebase storage:rules:get > backup/rules/storage.release.rules
```

---
## 15. Sign-Off Record Template
```
Release Version: v1.1.0
Commit SHA:
Rules Test Run ID:
Device Test Latency (avg):
Security Incidents: (none/summary)
Flag State at Submission: false
Flag State at Public Rollout: true (date/time)
Approvals: Eng Lead / Product / Security
Notes:
```

---
End of Checklist.
