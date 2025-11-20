# Unified Stream Model Proposal

## Rationale
Current implementation splits live stream data across `liveStreams` (segments, live metadata) and `streams` (presence/status/messages) plus legacy embedded arrays. This increases inconsistency risk and complicates migration to real HLS/DASH.

## Target Authoritative Structure
Firestore (vNext):
```
liveStreams/{streamId}
  hostUid: string
  status: 'live' | 'ended' | 'error'
  createdAt: TS
  startedAt: TS
  endedAt?: TS
  title: string
  description: string
  thumbnailUrl?: string
  currentSegment: number
  segmentVariant: 'source' | '360p' | '720p' | '1080p'
  viewCount: number
  likes: number
  health: {
    lastSegmentTs: TS | number
    bufferHealth: 'good' | 'degraded' | 'stalled'
    uploadLatencyMs?: number
    recentErrorCount?: number
  }
  metrics: {
    totalSegments: number
    avgSegmentSizeBytes?: number
    peakViewers?: number
  }
  playlistUrl?: string   // points to generated HLS/DASH manifest when ready
  retentionClass: 'live' | 'vod' | 'archive'
  migration: { segmentsSubcollection: boolean }
```

### Subcollections
```
liveStreams/{streamId}/segments/{segmentNumber}
  number: number
  variant: 'source' | '360p' | '720p' | '1080p'
  url: string
  uploadedAt: TS
  sizeBytes?: number
  durationMs?: number

liveStreams/{streamId}/comments/{commentId}
  userId: string
  userName: string
  userPhotoURL?: string
  content: string (<=500 chars)
  timestamp: TS
  likes: number
  isHighlighted: boolean

liveStreams/{streamId}/likes/{userId}
  userId: string
  likedAt: TS

liveStreams/{streamId}/messages/{messageId}
  uid: string
  displayName: string
  text: string (<=500)
  createdAt: TS

liveStreams/{streamId}/events/{eventId}
  type: 'quality_change' | 'error' | 'join' | 'leave' | 'gift'
  payload: object
  timestamp: TS
```

## Migration Phases
1. Phase 0 (Now): Remove embedded `comments` array, lazy-migrate existing arrays (implemented).
2. Phase 1: Introduce `segments` subcollection in parallel with map; writer stores both; reader prefers subcollection if present.
3. Phase 2: Generate lightweight local manifest referencing segments subcollection; update viewer to parse manifest.
4. Phase 3: Add transcoding jobs; populate multi-bitrate variants; include variant field per segment.
5. Phase 4: Remove legacy `segments.{n}` map fields after >90% streams use subcollection.
6. Phase 5: Add playlistUrl referencing CDN location; viewer switches fully to HLS/DASH player.

## Backward Compatibility Strategy
- Dual-write segments (map + subcollection) during transition.
- Reader logic: try subcollection; fallback to map if variant missing.
- Feature flags to enable new playlist consumption gradually.

## Rollback Plan
- If playlist generation fails or transcoding instability detected, disable feature flag to revert to map-based playback instantly.
- Maintain last 10 segments in map for one release cycle.

## Monitoring / Metrics
- Segment upload latency (ms) per variant.
- Subcollection adoption rate (% of streams with >=5 segments stored as docs).
- Document size growth guard (warn >500KB).
- Playback stall events vs segment availability.

## Risks & Mitigations
- Firestore write amplification (dual-write): Keep segments short (<=3s) and consider write budget; monitor costs.
- Latency impact of transcoding: Start with source passthrough; add async transcoding for quality ladder later.
- Player compatibility: Feature-flag HLS playlist adoption; fallback path retained until stable.

## Next Engineering Tasks
- Implement dual-write for segments.
- Create segment read abstraction selecting source (subcollection vs map).
- Add manifest generator (client-side placeholder, server-side eventual).
- Update viewer to accept manifest URL.
- Instrument all new operations with analytics events.
