# 05 Implementation Tasks & Ticket Breakdown

## Guiding Principles
- Additive changes first; no schema deletions in Phase A.
- Each ticket must pass lint/type/tests and include observability hooks where relevant.
- Critical race points (e.g., `runningBalance`) must use Firestore `runTransaction` for atomicity.

## Ticket 1: Cloud Functions / Backend Handlers for LedgerTransactions
Goal: Safely apply new ledger transactions and update derived wallet aggregates without race conditions.

### Scope
- Implement a server-side endpoint or Cloud Function `createLedgerTransaction`.
- Enforce idempotency and concurrency controls.
- Maintain running balances in a transaction; optionally allow later removal if contention high.

### Steps
1. Define input validation schema (userId, kind, asset, amount, idempotencyKey).  
2. Look up idempotency registry (`idempotencyLedgerKeys/{hash}`) inside a transaction:
   - If exists → return existing transaction reference.  
3. Fetch latest wallet aggregate snapshot (e.g., `wallets/{userId}`) inside the same transaction.  
4. Compute new running balance: previousBalance + (direction == credit ? amount : -amount).  
5. Write new `ledgerTransactions/{txnId}` document with computed `runningBalance` and metadata.  
6. Update wallet aggregate fields (`balanceCoin`, optional `balanceGem`, `lastLedgerTxnId`, `updatedAt`).  
7. Commit transaction; on success create idempotency registry entry.  
8. Emit analytics event (`ledger_txn_created`) with fields: userId, kind, amount, correlationId?, riskScore?.  
9. Error handling: distinguish retryable vs terminal; do NOT partial write ledger without wallet update (all in one transaction).  

### Concurrency & Race Mitigation
- All balance mutation + ledger insert occurs within a single `runTransaction` block.  
- Server checks for transaction conflicts; on contention retry with exponential backoff (limited attempts).  
- Consider dropping `runningBalance` field if conflict frequency > threshold; rely on recomputation for reads.  

### Idempotency Strategy
- `idempotencyKey` hashed (SHA256) → registry doc.  
- Transaction pre-check ensures at-most-once semantics.  
- Collisions return existing transaction payload; client treats as success.  

### Observability
- Log structured event with latency, retries count, conflict count.  
- Metrics: `ledger_txn_conflicts`, `ledger_txn_latency_ms`, `ledger_txn_idempotency_hits`.  

### Security & Audit
- Ensure `createdBy` field set based on auth context.  
- Validate user authorization for kind (e.g., `adjustment` restricted to admin).  
- No PII logged beyond userId.

### Rollback Considerations
- Feature flag gating new endpoint.  
- If instability: disable flag; ledger writes paused; legacy transaction path continues.  

## Ticket 2: Unified LiveSession Creation
Steps:
1. Extend existing stream start flow to create `liveSessions/{id}` with initial metadata (status 'active', viewerCount=0).  
2. Add feature flag: `liveSessionWriteEnabled`.  
3. Map legacy fields (currentSegmentIndex=0, analytics counters=0).  
4. Log event `live_session_started`.  
5. Dual-write segment ingestion path (legacy + new) behind `segmentDualWriteEnabled`.  
6. Monitor write latency & error rates; rollback flag if anomalies.

## Ticket 3: Frontend Send Gift Refactor
Steps:
1. Introduce new API client `EconomyService.sendGift(sessionId, giftTypeId, idempotencyKey)`.  
2. Generate idempotencyKey (UUID v4) per gift send attempt.  
3. Call new backend endpoint; on success update local optimistic balance.  
4. Handle idempotent replay gracefully (same giftEventId).  
5. Emit analytics event `gift_send_attempt` and `gift_send_success` with correlationId.  
6. Feature flag gating new pathway (`giftApiV2Enabled`).  
7. Fallback to legacy logic if endpoint failure & flag not forced.

## Ticket 4: Migration Adjustment Script
Steps:
1. Enumerate all wallet docs.  
2. For each user: if no adjustment txn present create `adjustment` ledger transaction (admin created).  
3. Record statistics (count, total migrated amount).  
4. Dry-run mode (metrics only).  
5. Emit progress logs and divergence check post-run.

## Ticket 5: Reconciliation Job
Steps:
1. Scan ledger transactions per user; compute derived balance.  
2. Compare to legacy balance field.  
3. Store divergence metric; if > threshold raise alert.  
4. Report summary (p95 divergence, max, affected user count).

## Ticket 6: Segment Dual-Write Enhancements
Steps:
1. Wrap segment metadata writes in a function adding manifest doc update.  
2. Add checksum field for data integrity.  
3. Metrics: ingest latency & dual-write delta.  
4. Error fallback: if new write fails, log and continue legacy path; escalate if repeated.

## Ticket 7: Idempotency Registry Collection Setup
Steps:
1. Create collection design doc (keyHash, createdAt, txnId).  
2. Implement simple TTL cleanup for stale keys (optional future).  
3. Integrate with Ticket 1 logic.

## Ticket 8: Metrics & Alerts Configuration
Steps:
1. Define dashboard panels (conflicts, latency, divergence).  
2. Set alert thresholds (conflicts > X/min, divergence > Y%).  
3. Add incident runbook link in docs.

## Ticket 9: Feature Flag Management
Steps:
1. Introduce flags: `ledgerWriteEnabled`, `ledgerReadEnabled`, `liveSessionWriteEnabled`, `segmentDualWriteEnabled`, `giftApiV2Enabled`.  
2. Document rollout order.  
3. Safeguard: automatic disable if error rate spike.

## Ticket 10: Documentation & Developer Guide
Steps:
1. Summarize new endpoint contracts.  
2. Provide examples (gift send, ledger adjustment).  
3. Add troubleshooting (conflict resolution, idempotency collisions).  

## RunningBalance Handling
- Always computed within Firestore transaction (read current wallet aggregate + write new).  
- If contention metrics high: optional phase removing `runningBalance` field from write path; compute on read for admin audit only.  
- Do NOT attempt client-side precomputation.

## Risk Matrix (Selected Tickets)
| Ticket | Risk | Mitigation |
|--------|------|-----------|
| 1 | High write contention | Transaction retries + possible removal of runningBalance |
| 2 | Schema mismatch | Additive fields + flags |
| 3 | Double spend due to retry | Idempotency key mandatory |
| 4 | Incorrect bootstrap amount | Dry-run + sampled verification |

## Open Questions
1. Should wallet aggregate store per-asset separate doc vs single combined doc?  
2. Need cryptographic signature for high-value withdrawal events?  
3. Approx distinct viewers: include now or defer?  
