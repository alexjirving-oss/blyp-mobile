# Analytics Retention & TTL Enforcement Plan (90 Days)

## Objective
Ensure all analytics events respect a 90-day retention window, supporting privacy, cost control, and compliance.

## Current State
- Events stored in Firestore collection `analytics` via `EnterpriseAnalyticsService`.
- New fields added: `retentionDays`, `retentionExpiresAt` (epoch ms).
- Scheduled Cloud Function `purgeExpiredAnalytics` runs every 24h and deletes expired events in batches; writes run logs to `analyticsPurgeLog`.
- Additional observability event `abr_estimator_metrics` emitted (throttled) with estimator EWMA, sample stats, and buffer/network context.

## Target
1. Automatic purge of expired events (>90 days) daily.
2. Optional export/archive of near-expiry events to cold storage (BigQuery / Cloud Storage) before deletion.
3. Monitoring of purge success and residual aged documents.

## Data Model Additions
Each event document includes:
```
retentionDays: number (default 90)
retentionExpiresAt: number (epoch ms)
```

## Purge Mechanism Options
| Option | Approach | Pros | Cons |
|--------|----------|------|------|
| Cloud Function (Scheduled) | Scheduled trigger queries expired docs and batch deletes | Simple, serverless | Query cost; potential timeouts |
| Cloud Scheduler + CF Batch | Scheduler hits HTTPS CF endpoint performing segmented purge | Controlled runtime | Slightly more setup |
| Backend Worker (Queue) | Worker processes expiry using event time index | Scales with volume | Requires infra & queue |

Initial recommendation: **Scheduled Cloud Function** (runs every night). If volume grows (>10M docs), consider worker approach with partitioning.

## Purge Algorithm (Cloud Function Pseudocode)
```
const BATCH_LIMIT = 450; // Keep under Firestore 500 limit
const NOW = Date.now();
let deleted = 0;

while (true) {
  const snap = await firestore.collection('analytics')
    .where('retentionExpiresAt', '<=', NOW)
    .orderBy('retentionExpiresAt')
    .limit(BATCH_LIMIT)
    .get();
  if (snap.empty) break;
  const batch = firestore.batch();
  snap.docs.forEach(doc => batch.delete(doc.ref));
  await batch.commit();
  deleted += snap.size;
}
logMetric('analytics_purge_deleted_count', deleted);
```

## Export (Optional Phase)
Before deletion, optionally:
1. Query near-expiry docs (expires within next 24h).
2. Stream to newline-delimited JSON file.
3. Upload to `gs://blyp-analytics-archive/YYYY/MM/DD/analytics-<timestamp>.json.gz`.
4. Log archive path.

## Monitoring & Metrics
Track:
- `analytics_purge_deleted_count` (per run)
- `analytics_purge_duration_ms`
- `analytics_residual_expired_count` (post-run quick check)
- `analytics_archive_file_size_bytes` (if archiving)

Alerts:
- Residual expired count > threshold (e.g., >50K) after purge.
- Purge fails 2 consecutive days.

## Security & Privacy
- Archived data must exclude PII beyond user IDs and non-sensitive metadata.
- Ensure user deletion requests also trigger deletion of their analytics events (future enhancement: user-scoped purge job).

## Rollback Plan
If purge causes performance issues or accidental over-deletion:
1. Disable Cloud Scheduler trigger.
2. Restore from cold archive (if needed) by importing JSON back (ONLY if justified; prefer not restoring events).
3. Investigate query cost spikes or index contention.

## Indexing
Create composite index if needed for `retentionExpiresAt` queries:
- Single-field index on `retentionExpiresAt` is usually sufficient.

## Phased Rollout
1. (Done) Add retention metadata fields.
2. Deploy purge function in dry-run mode (log counts only).
3. Validate logs for 2–3 days.
4. Enable deletions.
5. Add optional archive step after stability proven.

## Next Actions
- Verify Cloud Scheduler is deployed/enabled for `purgeExpiredAnalytics` (daily around 02:00 UTC).
- Add dashboard widgets for purge metrics and residual checks.
- Optional: add archive pre-delete phase if needed for long-term analysis.

## Risks
- High query cost if many expired events accumulate; mitigate with daily run.
- Deletion race if documents being written concurrently with identical `retentionExpiresAt`—acceptable; eventual consistency.

## Success Criteria
- No analytics documents older than 90 days persist beyond 24h grace.
- Purge runtime < 5 minutes for expected scale (<5M docs).
- Monitoring shows stable deletion counts and near-zero residuals.
