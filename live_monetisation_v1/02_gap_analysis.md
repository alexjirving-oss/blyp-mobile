# Phase A Gap Analysis: Live Streaming & Coin Economy

## 1. Summary
The current Blyp implementation uses two partially overlapping live stream data models (`liveStreams` and `streams`) plus ad‑hoc presence/chat collections. Economic balance changes (coins, gems) occur via direct document mutation accompanied by loosely structured `transactions` entries. This creates fragmentation, audit gaps, scalability risks, and migration friction toward the target playlist + ledger architecture.

## 2. Current Live Models
### 2.1 `liveStreams` (HLSLiveStreamService)
Fields observed (representative):
- `segments.{n}.url` – Map of segment indices to URLs (single Firestore doc)  
- `currentSegment` – Latest segment index  
- Health/meta: timestamps, status, error counters  
- View-related counters (may be inconsistent)  

### 2.2 `streams` (LiveService)
Representative responsibilities:
- Stream lifecycle (create/end)  
- Presence: viewer join/leave counts  
- Chat/messages subcollection or parallel collection  

### 2.3 Fragmentation Issues
| Concern | Impact |
|---------|--------|
| Dual authoritative sources (`liveStreams` vs `streams`) | Race conditions, divergent status fields |
| Segment map in a single doc | Document bloat risk, Firestore size & write contention |
| Mixed concerns (segments + health + ephemeral presence) | Harder caching, partial failure scenarios |
| Viewer count logic duplication | Inconsistent analytics & fraud signals |
| Lack of unified moderation state | Hard to enact kick/mute globally |
| No playlist manifest abstraction | Hard migration path to real HLS/DASH |

## 3. Technical Risks (Live)
1. **Firestore Doc Size Growth**: Unbounded `segments` map increases payload size & update contention; risk of hitting 1MB soft practical thresholds and 20k field limits.  
2. **Write Hotspot**: Constant updates to one doc for every segment create high update frequency & potential latency spikes.  
3. **Concurrency & Ordering**: Segment uploads rely on in‑memory controls; no persisted semaphore or idempotency key → risk of duplicate/ skipped segment indices.  
4. **Partial Failure Visibility**: Health fields are embedded; no structured event feed for diagnostics (harder to backfill analytics).  
5. **Migration Complexity**: Introducing a playlist + subcollections will require dual writes; current model not isolated for easy parallel adoption.  
6. **Moderation & Safety**: No unified moderation actions log; hard to audit real‑time enforcement (mute/kick).  

## 4. Economy Model Today
### 4.1 Wallet & Transactions
- Direct `wallets/{userId}` doc balance mutations via Firestore transaction.  
- `transactions` collection entries: `{ userId, type, amount, reason, balance, timestamp }` (mutable schema; limited normalization).  
- Separate gem service with parallel pattern (duplication).  

### 4.2 Audit & Ledger Gaps
| Gap | Detail | Risk |
|-----|--------|------|
| Direct balance mutation | Balance stored as mutable state | Replay / reconciliation difficult |
| Missing idempotency keys | Gift/purchase repeats may double spend | Financial inconsistency |
| No correlation IDs | Multi-party events (gift debit + creator credit) not linkable | Forensic difficulty |
| Status lifecycle absent | Purchases not modeled as pending/settled | Hard refund & dispute handling |
| No fraud flags on events | No embedded risk scoring data | Slower detection of abuse |
| Missing withdrawal model | No representation of payout requests/settlement | Untracked liabilities |
| Separate coin vs gem logic | Duplication, divergence risk | Maintenance overhead |
| Sparse metadata | Provider references not structured (e.g., externalId) | Limited compliance/audit |

### 4.3 Resulting Risks (Economy)
1. **Reconciliation Difficulty**: Cannot rebuild balances purely from immutable events; reliance on snapshot field.  
2. **Double Spend Potential**: Race conditions without idempotency for rapid gift sends or retries.  
3. **Refund / Chargeback Complexity**: Lack of explicit reversal transaction type complicates net earnings calculation.  
4. **Fraud Analysis Weakness**: Missing risk scoring & correlation limits machine detection.  
5. **Regulatory / Audit Unreadiness**: Immutable & appended-only ledger expectations not met for compliance.  

## 5. Observability Gaps
- Live: No structured segment ingest latency events; viewer join/leave analytics not consistently correlated to stream ID across both models.  
- Economy: No consistent transaction event schema including idempotencyKey, correlationId, risk flags.  

## 6. Migration Constraints & Considerations
| Constraint | Implication |
|------------|------------|
| Need zero-downtime switch | Requires dual-write phase (legacy + new) |
| Existing clients expect current doc shapes | Target model must be additive until cutover |
| Firestore cost sensitivity | Avoid excessive write amplification (batch segments) |
| Analytics retention target (90d) | Ledger & segment events must include TTL or clear archivable partitions |

## 7. Security & Compliance Concerns
- Missing structured audit for economic events risks regulatory non-compliance (payout, disputes).  
- Lack of moderation action log in live sessions reduces accountability for enforcement decisions.  

## 8. Summary of Required Remediations
1. Unify live models → single `LiveSession` doc + focused subcollections.  
2. Replace segment map with `segments` subcollection; introduce lightweight manifest doc.  
3. Introduce immutable, event-sourced `ledgerTransactions` with idempotency & correlation.  
4. Implement dual-write migration (legacy + new) with observability counters.  
5. Add moderationActions and gifts subcollections for audit clarity.  
6. Embed fraud/risk metadata into ledger events for future scoring.  

## 9. Open Questions (For Target Spec)
1. Preferred external payment processor for withdrawals?  
2. Fee model for gifts (platform commission %) – store per gift or global config?  
3. Maximum live session duration / retention policy?  
4. Required multi-bitrate variants initial set?  
5. Real-time risk scoring mechanism (synchronous vs async enrichment)?  
6. Need for regional data partitioning in ledger?  
