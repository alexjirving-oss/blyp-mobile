# Phase A Target Specification: Unified Live Session & Event-Sourced Economy

## 1. Goals
- Consolidate dual live models (`liveStreams`, `streams`) into a single authoritative `LiveSession` collection.  
- Replace mutable wallet balance pattern with an event-sourced ledger enabling deterministic reconciliation.  
- Provide additive, non-breaking schema allowing staged migration (dual-write) and rollback.  
- Improve auditability, fraud detection hooks, and moderation capability.  

## 2. Unified LiveSession Model
Collection: `liveSessions`

### 2.1 LiveSession Document (Authoritative Metadata)
```
liveSessions/{sessionId} {
  creatorUserId: string,
  status: 'active' | 'ended' | 'error' | 'starting',
  startedAt: Timestamp,
  endedAt?: Timestamp,
  currentSegmentIndex: number,              // Highest ready segment
  segmentWindowSize: number,                // Retention rolling window size
  viewerCount: number,                      // Last known aggregate
  totalUniqueViewers: number,               // Cardinality (approx; hyperloglog future)
  streamHealth: {
    lastSegmentAt: Timestamp,
    stalled: boolean,
    errorCodes: string[],
    avgSegmentIngestMs?: number
  },
  economy: {
    totalCoinsEarned: number,
    giftEvents: number
  },
  moderation: {
    isSuspended: boolean,
    activeModerationFlags: string[]
  },
  analytics: {
    joinCount: number,
    chatMessageCount: number,
    giftCount: number
  },
  version: 1,
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

### 2.2 Subcollections
1. `liveSessions/{id}/segments`  
2. `liveSessions/{id}/chatMessages`  
3. `liveSessions/{id}/gifts`  
4. `liveSessions/{id}/moderationActions`  

#### 2.2.1 Segment Document
```
segments/{segmentId} {
  index: number,                      // Sequential index
  uploadedAt: Timestamp,
  durationSeconds: number,
  storagePath: string,                // e.g. streams/{sessionId}/source/{index}.ts
  byteSize: number,
  checksum?: string,
  transcoded: {
    variants: {
      [variantId: string]: {
        path: string,                 // streams/{sessionId}/{variantId}/{index}.ts
        bitrateKbps: number,
        width: number,
        height: number
      }
    },
    status: 'pending' | 'transcoding' | 'ready' | 'error'
  },
  purgeEligible: boolean,             // For retention trimming
  errors?: string[]
}
```

#### 2.2.2 ChatMessage Document
```
chatMessages/{messageId} {
  userId: string,
  sessionId: string,
  text: string,
  createdAt: Timestamp,
  clientMessageId?: string,          // Idempotency from client
  moderationFlags?: string[],
  shadowBanned?: boolean,
  sequence: number                   // Monotonic ordering (server assigned)
}
```

#### 2.2.3 GiftEvent Document
```
gifts/{giftEventId} {
  sessionId: string,
  senderUserId: string,
  creatorUserId: string,
  giftTypeId: string,
  giftVersion: number,
  coinsSpent: number,                 // Gross spend
  coinsCredited: number,              // Net to creator (post fee)
  ledgerTransactionIds: {
    debitSender: string,
    creditCreator: string
  },
  clientEventId?: string,             // Idempotency key
  createdAt: Timestamp,
  animationRef?: string,
  metadata?: {
    platformFeePercent?: number
  }
}
```

#### 2.2.4 ModerationAction Document
```
moderationActions/{actionId} {
  sessionId: string,
  actorUserId: string,                // Admin / moderator
  targetUserId?: string,
  type: 'mute' | 'kick' | 'slow_mode' | 'ban' | 'flag',
  reasonCode?: string,
  createdAt: Timestamp,
  expiresAt?: Timestamp,
  notes?: string
}
```

## 3. Event-Sourced Ledger
Collection: `ledgerTransactions` (Global).
Derived balances computed by summing ordered immutable transactions per asset.

### 3.1 LedgerTransaction Schema
```
ledgerTransactions/{transactionId} {
  userId: string,
  kind: 'purchase' | 'gift_send' | 'gift_receive' | 'earning' | 'refund' | 'withdrawal_request' | 'withdrawal_settlement' | 'adjustment',
  asset: 'coin' | 'gem',
  amount: number,                     // Positive integer units
  direction: 'debit' | 'credit',      // Derived also by sign convention
  runningBalance: number,             // Balance AFTER applying this txn (optional early phase; can be deprecated later)
  sessionId?: string,                 // For live-related earnings/spend
  giftTypeId?: string,
  counterpartUserId?: string,         // For multi-party events (sender ↔ creator)
  correlationId?: string,             // Links related multi-tx events (gift pair, refund chain)
  idempotencyKey?: string,            // Ensures no duplicate application
  status: 'final' | 'pending',        // 'pending' for purchases/withdrawals prior to settlement
  purchase: {
    provider?: 'stripe' | 'paypal' | 'iap' | 'test',
    externalRef?: string,
    productId?: string
  }?,
  withdrawal?: {
    method?: 'paypal' | 'bank' | 'stripe_transfer',
    requestRef?: string
  }?,
  refundOfTransactionId?: string,
  adjustmentReasonCode?: string,      // For admin/manual adjustments
  fraud: {
    riskScore?: number,
    flags?: string[]
  }?,
  createdAt: Timestamp,
  createdBy: 'system' | 'user' | 'admin',
  metadata?: { [k: string]: any }
}
```
Notes:
- Immutable: No in-place balance editing; reversal/refund generates new transaction with `refundOfTransactionId` and opposite direction.  
- Idempotency: Client-supplied `idempotencyKey` applied to purchase/gift_send to prevent duplicate processing.  
- Correlation: A gift produces two transactions (debit sender, credit creator) sharing a `correlationId`.  
- Running balance initially stored for fast reads; can be recomputed for audit (event sourcing).  

### 3.2 Balance Derivation
`SELECT SUM(CASE WHEN direction='credit' THEN amount ELSE -amount END)` grouped per user+asset ordered by createdAt. RunningBalance field optional accelerator; validated periodically by recomputation.

### 3.3 Idempotency & Concurrency Rules
- Any mutation endpoint requires `idempotencyKey`; server stores hash → if collision with identical payload, return existing transaction(s).  
- Gifts: Validate sender balance before writing; atomic creation of paired transactions within a Firestore transaction.  

## 4. GiftType Catalog
Collection: `giftTypes`
```
giftTypes/{giftTypeId} {
  name: string,
  priceCoins: number,
  rarity: 'common' | 'rare' | 'epic' | 'legendary',
  animationAssetRef?: string,
  platformFeePercent: number,         // Applied to compute creator net
  active: boolean,
  version: number,
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

## 5. API Contracts (Phase A – High-Level)
### 5.1 StartLiveSession
Input:
```
POST /v1/live/start {
  creatorUserId: string,
  segmentWindowSize?: number,
  initialVariants?: string[]          // e.g. ['source'] placeholder
}
```
Output:
```
{ sessionId: string, startedAt: ISO8601, status: 'active' }
```

### 5.2 SendGift
Input:
```
POST /v1/economy/gift {
  sessionId: string,
  giftTypeId: string,
  idempotencyKey: string
}
```
Process:
- Validate session active & gift active.
- Debit sender; credit creator with platform fee applied.
Output:
```
{ giftEventId: string, senderBalanceAfter: number, creatorCoinsEarned: number }
```

### 5.3 PurchaseCoins
Input:
```
POST /v1/economy/purchase {
  packageId: string,
  provider: 'stripe' | 'iap' | 'test',
  idempotencyKey: string,
  externalRef?: string
}
```
Output:
```
{ transactionId: string, balanceAfter: number, status: 'pending' | 'final' }
```

## 6. Migration Strategy (Additive)
1. **Dual Write Phase**: On segment ingest, write existing `segments` map AND new `segments` subcollection doc (index + storagePath).  
2. **Playlist Introduction**: Add `manifest` lightweight doc referencing subcollection indices; viewer optionally reads new path behind feature flag.  
3. **Economy Dual Ledger**: Continue legacy `transactions` writes; simultaneously emit normalized `ledgerTransactions`.  
4. **Backfill**: Batch process legacy transactions → ledgerTransactions (with synthetic correlationId).  
5. **Validation**: Periodic reconciliation job compares legacy balance vs event-sourced computed balance; alert on mismatch.  
6. **Cutover**: Switch read paths (feature flag) for balance & segment playback; freeze legacy fields; schedule removal after retention window.  
7. **Rollback**: Disable flags; legacy paths remain intact until confirmed stable.  

## 7. Observability & Metrics
- Segment ingest latency: `upload_start`, `upload_complete` events with ms delta.  
- Gift events: log `gift_send` including correlationId, riskScore.  
- Balance divergence gauge: computed difference legacy vs ledger.  
- Session health counters: stalled flag transitions, time since last segment.  

## 8. Fraud & Risk Hooks (Foundational)
- Gift send → compute preliminary risk score (frequency, amount scaling).  
- Purchase → provider verification status; pending until provider callback (settlement transaction or status flip).  

## 9. Privacy & Compliance
- No PII (emails) inside ledger; only userId references.  
- Withdrawal events must be extensible for KYC metadata (phase B).  

## 10. Open Items (Beyond Phase A)
- Multi-bitrate transcoding pipeline integration & CDN signed URL strategy.  
- HyperLogLog or approximate distinct viewer counts.  
- Real-time moderation dashboard & automated keyword filtering.  
- Regional ledger sharding for data residency.  

## 11. Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| Write amplification (dual write) | Limit Phase A duration; batch backfill only once |
| Ledger reconciliation drift | Scheduled validation job + alert threshold |
| Idempotency key collisions | Namespace per endpoint + hash payload |
| Incomplete gift pairing | CorrelationId & atomic Firestore transaction |
| Latency increase on segment ingest | Optimize subcollection doc size; defer transcoding asynchronous |

## 12. Rollback Plan
- Disable new feature flags (ledger_read, playlist_read).  
- Continue legacy writes; ignore ledger transactions for balance calculation.  
- Archive new collections; no destructive operations until stable window passed.  

## 13. Compliance Alignment
- Immutable ledger ensures audit trail; refunds modeled as separate reversing transactions.  
- ModerationActions subcollection supports enforcement auditability.  

## 14. Success Metrics (Phase A)
- <5% discrepancy between legacy and ledger computed balances over 7 days.  
- Segment ingest p95 latency within acceptable baseline (<X ms TBD).  
- No >1% gift duplication due to idempotency failures.  
- Zero runtime crashes attributed to new schema reads (monitored via crash analytics).  

