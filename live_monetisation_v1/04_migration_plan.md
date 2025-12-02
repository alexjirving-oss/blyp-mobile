# 04 Migration Plan: LiveSession & LedgerTransaction (Phase A)

## 1. Objectives
- Introduce event-sourced `ledgerTransactions` while retaining legacy balance fields for 48h (double-write window).
- Unify live stream metadata into `liveSessions` without breaking existing viewers immediately.
- Provide clear rollback and observability gates.

## 2. Scope
Phase A only: additive schema + dual writes; no removal of legacy collections (`liveStreams`, `streams`, `wallets.balance` field, old `transactions`).

## 3. Double-Write Strategy (Economy)
| Phase | Writes | Reads | Duration |
|-------|--------|-------|----------|
| DW (48h) | Legacy `transactions` + New `ledgerTransactions` | Legacy balance field | 48h or until stability SLO met |
| Verification | Same as DW | Experiment flag to compare computed vs legacy | Overlaps DW |
| Cutover | New ledger only (legacy writes optional) | Ledger-derived balance | Post verification |
| Decommission | Stop legacy writes | Ledger only | After retention window |

### 3.1 Execution Steps
1. Deploy Cloud Function / server handler to write ledger transaction on each legacy transaction commit (if not already migrating direct callers).  
2. Add idempotency validation (store `idempotencyKey` index collection or hashed field).  
3. Nightly reconciliation job: compute derived balance vs stored legacy; log divergence metric.  
4. After stable (<5% divergence threshold for 24h), progress to cutover.  

## 4. Backfill Strategy
Two options (choose based on legacy data volume):
1. **Summation Backfill**: Read all legacy `transactions` per user, sum net amounts → write a synthetic `ledgerTransactions` chain. (Costly if large volume.)
2. **Migration Adjustment Transaction** (Recommended): For each user with existing balance, create a single `ledgerTransactions` record:
```
kind: 'adjustment'
amount: <legacyBalance>
direction: 'credit'
correlationId: 'migration_v1'
adjustmentReasonCode: 'initial_ledger_bootstrap'
```
Then only ledger new events going forward. Provides deterministic starting point.

### 4.1 Steps (Recommended Option)
1. Enumerate all wallet docs.  
2. For each user, if not already bootstrapped (no transaction with correlationId 'migration_v1'):  
   - Write adjustment transaction.  
   - Store marker (could be the existence of that transaction).  
3. Start double-write for new real-time economic events.  

## 5. LiveSession Migration
### 5.1 Parallel Write
- On stream start: create both legacy `streams/{id}` and new `liveSessions/{id}` with mapped fields.
- On segment upload: write to `liveStreams` segment map AND new `liveSessions/{id}/segments` doc.
- On viewer presence update: continue legacy path; optionally feature-flag mirrored update to `liveSessions.viewerCount`.

### 5.2 Playlist Manifest (Optional Early)
- Introduce `liveSessions/{id}/manifest` doc referencing segment indices; legacy viewer ignores it until flag enabled.

## 6. Observability & Metrics
| Metric | Purpose |
|--------|---------|
| ledger_balance_divergence | Detect mismatch vs legacy balance |
| gift_idempotency_collision_count | Idempotency health |
| segment_dual_write_latency | Impact of parallel writes |
| live_session_missing_segment_ratio | Migration completeness |
| adjustment_bootstrap_count | Backfill progress |

## 7. Rollback Plan
Trigger conditions: divergence > threshold, repeated write failures, latency spike.
1. Disable ledger read feature flag; revert clients to legacy balance reads.  
2. Continue legacy writes; pause ledger writes (optional) while investigating.  
3. Preserve all created ledger docs (immutable) for later reuse.  
4. Post-mortem analysis: identify root cause (idempotency failure, race, write quota exceeded).  

## 8. Failure Scenarios & Mitigations
| Scenario | Mitigation |
|----------|------------|
| Write quota spike due to dual writes | Batch segment metadata or reduce frequency of non-critical updates |
| Ledger divergence | Run targeted recomputation audit; identify missing or duplicate idempotency keys |
| High contention on runningBalance | Use Firestore transaction per ledger insert; consider removal of `runningBalance` field if persistent contention observed |
| Segment ordering mismatch | Persist index lock via transaction; verify gap detection job |

## 9. Data Integrity Tools
- Reconciliation job (scheduled): recompute ledger per user and compare.  
- Gap detection: ensure segments indexes contiguous; log anomalies.  
- Idempotency registry: optional collection `idempotencyLedgerKeys/{keyHash}` for fast lookup.  

## 10. Security & Compliance Notes
- Adjustment transactions carry explicit reason codes for audit.  
- No destructive legacy data removal until compliance review & retention window passes.  

## 11. Success Exit Criteria
- Ledger divergence average <1% for 24h.  
- No critical error spikes (p95 ledger write latency within baseline).  
- Gift idempotency collision ratio <0.1%.  
- Segment dual-write overhead acceptable (<X ms additional ingest).  

## 12. Open Questions
1. Do we require per-region adjustments for initial bootstrap?  
2. Should viewerCount in `liveSessions` be computed via periodic aggregation rather than direct increments?  
3. How long to retain legacy `segments` map post cutover?  
