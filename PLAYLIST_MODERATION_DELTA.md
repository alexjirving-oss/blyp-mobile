# Delta Update: Moderation & Adaptive Playlist Enhancements

Date: 2025-11-18

## Summary
This document records incremental, non-breaking changes extending Trust & Safety and Streaming transition features:
- Added moderation queue aggregation (Cloud Functions) and admin UI consumption.
- Introduced role gating for moderation access via `useIsAdmin`.
- Implemented adaptive quality selection heuristics and dynamic adaptation loop (periodic evaluation, stall-aware) in viewer.
- Added buffer duration metric (seconds) informing upgrade/downgrade decisions.
- Added playlist fetch + parser integration; remote master/quality playlists optionally consumed when `playlistViewerEnabled` flag set.
- Instrumented moderation actions and playlist quality decisions with analytics events (including experiment ID when present).
- Integrated rolling bandwidth sampling and cooldown-based gating to reduce oscillation.

## Components Added / Updated
- `functions/src/index.ts`: `aggregateReport`, `recalcModerationQueue` functions.
- `src/services/ModerationQueueService.js`, `src/hooks/useModerationQueue.js`, `src/screens/ModerationQueueScreen.js` (passes `actorId`).
- `src/hooks/useIsAdmin.js` for role gating.
- `src/services/PlaylistFetchService.js`, `src/services/PlaylistParserService.js`, `src/services/QualitySelectionService.js`.
- `src/services/QualityAdaptationService.js` (heuristic ABR + bufferSeconds + bandwidth gating + analytics helper).
- `src/components/LiveStreamViewer.js` (adaptation loop, bufferSeconds integration, bandwidth sampling, cooldown gating, corrected analytics).
- `src/services/SegmentBandwidthEstimatorService.js` (rolling bandwidth sampling feeding adaptation decisions).

## Viewer Changes
`LiveStreamViewer.js` now:
1. Attempts remote master playlist fetch when playlist viewer mode active.
2. Parses variants and selects initial quality based on network type (wifi → higher; cellular → middle; offline/unknown → lowest).
3. Runs dynamic adaptation loop every 8s evaluating: stall window count, buffer segment count, bufferSeconds, network type, last segment latency, and rolling bandwidth estimate (EWMA smoothed).
4. Emits events: `playlist_master_fetched`, `playlist_quality_selected`, `playlist_mode_segments_loaded`, `quality_upgrade`, `quality_downgrade`, `quality_switch_error`, `quality_switch_skipped_cooldown`, `quality_switch_skipped_delta`, `quality_switch_skipped_confidence`, `quality_switch_skipped_volatility` (with experimentId when flag set).
5. BufferSeconds computed from parsed segment durations (fallback 2s each) plus bandwidth sampling every 3rd segment (precise 16KB ranged GET timing) guiding adaptation decisions.
6. Cooldown: minimum 20s between quality switches to limit oscillation.
7. Minimum bitrate delta threshold: next variant must exceed current variant bandwidth by ≥15% to qualify for upgrade (reduces churn among near-adjacent variants).
8. Confidence gating: require ≥3 recent bandwidth samples and last sample ≤20s old to permit upgrades; otherwise emit skip-confidence analytics.
9. Volatility gating: compute coefficient of variation from estimator (stddev/mean). If ≥0.5 with fresh samples, block upgrades and emit skip-volatility analytics.

## Moderation Flow
1. Reports create/aggregate via trigger → `moderationQueue` doc per target.
2. Admin screen lists queue with priority scoring (reports + reason diversity + aging).
3. Actions (under review, resolve) emit `moderation_action` analytics events.
4. Actor attribution added: `actorId` persisted on under-review and resolve actions; structured `resolution` object captures `actionType`, optional `ruleId`, and notes.

## Feature Flags & Experiments
- `EXPO_PUBLIC_PLAYLIST_VIEWER_ENABLED=1` enables remote playlist mode + adaptive selection & adaptation loop.
- `EXPO_PUBLIC_MANIFEST_ENABLED=1` retains local manifest generation fallback.
- `EXPO_PUBLIC_PLAYLIST_EXPERIMENT_ID` (optional) tags playlist/adaptation analytics events for A/B tracking.

## Security & Privacy
- Admin gating is read-only role check (`users/{uid}.roles[]` or `isAdmin`).
- No new secrets introduced; playlist fetch uses existing Firebase Storage security rules.
- Analytics events avoid PII beyond IDs.

## Migration Considerations
- Adaptive logic now heuristic + rolling sampling; upgrade path: precise per-segment throughput logging (bytes/time), EWMA bitrate estimation, predictive congestion avoidance, multi-variant parallel prefetch.
- Role system can later unify with backend permissions and JWT claims.
- Multi-variant switching currently periodic variant fetch; future improvement: parallel prefetch of next higher variant before upgrade.
- BufferSeconds metric relies on accurate EXTINF durations; ensure transcoder emits them consistently.

## Next Recommended Steps
1. Confidence scoring: variance & sample count to gate aggressive upgrades.
2. Add `quality_switch_skipped_delta` analytics emission when delta gating blocks upgrade.
3. Predictive prefetch of next higher variant segments before upgrade commit.
4. Expand moderation resolution schema (ruleId, penaltyTier, reversible actions) & analytics.
5. Playlist vs segment-map experiment: measure stall rate, average quality, join latency, downgrade frequency.
6. Dashboard: quality switch success rate, skipped cooldown vs delta reasons, bandwidth distribution percentiles.

## Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| Misclassification of network type leads to suboptimal quality | Conservative heuristics; fallback to parsed first variant |
| Unauthorized user views moderation queue due to missing role doc | Role gating; missing doc defaults to false |
| Playlist fetch latency increases startup delay | Feature flag gating + local manifest fallback |
| Quality selection event noise | 8s evaluation + 20s cooldown; future min bitrate delta threshold |
| BufferSeconds misestimation due to missing EXTINF | Fallback duration (2s) + future validation instrumentation |
| Sampling overhead (ranged GET) | Sample every 3rd segment; 16KB partial fetch keeps overhead low |
| Marginal bitrate upgrades causing churn | Enforced ≥15% delta threshold + planned skip analytics |
| Bandwidth estimate volatility | Weighted decay window (60s) + cooldown gating reduces oscillation |

---
End of delta update.
