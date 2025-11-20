# Moderation & Reporting Enhancement Plan

## Rationale
Early moderation tooling is minimal. Scaling live + short-form content requires structured review queues, audit trails, and real-time live controls to maintain safety and compliance.

## Current Gaps
- No unified moderation queue collection.
- Limited audit logging of moderation actions.
- Live moderation (mute/kick/slow mode) not formalized.
- Lack of keyword filtering / auto-flag signals.

## Target Components
1. Reporting Ingest: `reports/{reportId}` with target (user|stream|content), reason code, timestamp, reporterId.
2. Moderation Queue: `moderationQueue/{itemId}` referencing content + aggregated signals.
3. Actions Log: `moderationActions/{actionId}` with actorId, targetId, actionType, reason, timestamp, ruleId.
4. Live Controls: Service methods `muteUser(streamId,userId,duration)`, `setSlowMode(streamId,intervalMs)`, `kickUser(streamId,userId)`.
5. Keyword Filter: Config collection `moderationConfig/keywordFilters` (patterns, severity).

## Data Model Sketch
```
reports/{id}
  targetType: 'stream' | 'user' | 'content'
  targetId: string
  reporterId: string
  reasonCode: string
  details?: string
  createdAt: TS
  status: 'open' | 'triaged' | 'closed'

moderationQueue/{id}
  targetType
  targetId
  openReports: number
  autoFlags: { nudity?: boolean, hate?: boolean, violence?: boolean }
  lastUpdated: TS

moderationActions/{id}
  actorId
  targetType
  targetId
  actionType: 'remove' | 'restrict' | 'age_gate' | 'warn' | 'strike' | 'ban' | 'mute' | 'kick'
  reasonCode
  ruleId
  createdAt: TS
  expiresAt?: TS
```

## Phased Implementation
1. Reporting API: Add service for creating report documents.
2. Queue Aggregation: Cloud Function triggers on `reports` create; update/add queue item.
3. Actions Logging: Wrap any moderation effect in function that writes action log first.
4. Live Controls: Implement mute/kick/slow mode using per-stream subcollections (`liveStreams/{id}/controls`).
5. Keyword Filtering: Add pre-send check in chat message send path (reject or flag).

## Monitoring
- Report volume per hour.
- Average triage latency.
- Actions per moderator.
- False positive rate on auto-flags.

## Risks & Mitigation
- Performance cost of real-time keyword scanning: Precompile regex, limit to chat length.
- Abuse of reporting: Rate limit reports per user/time window.

## Next Steps
- Implement reporting service stub.
- Add action logging wrapper functions.
- Draft Cloud Function spec for queue aggregation.
