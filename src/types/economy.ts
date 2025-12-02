// Economy & Ledger Type Definitions (Phase A)
// Additive schema locking; no runtime logic here.

export enum TransactionKind {
  Purchase = 'purchase',
  GiftSend = 'gift_send',
  GiftReceive = 'gift_receive',
  Earning = 'earning',
  Refund = 'refund',
  WithdrawalRequest = 'withdrawal_request',
  WithdrawalSettlement = 'withdrawal_settlement',
  Adjustment = 'adjustment'
}

export type AssetCode = 'coin' | 'gem';
export type TransactionDirection = 'debit' | 'credit';

// Basic timestamp representation (Firestore Timestamp or JS Date acceptable)
export type TS = Date; // Store concrete conversion at usage boundaries.

export interface LedgerTransactionPurchaseMeta {
  provider?: 'stripe' | 'paypal' | 'iap' | 'test';
  externalRef?: string; // Provider charge/session id
  productId?: string;   // Package identifier
}

export interface LedgerTransactionWithdrawalMeta {
  method?: 'paypal' | 'bank' | 'stripe_transfer';
  requestRef?: string; // Internal withdrawal request id
}

export interface LedgerTransactionFraudMeta {
  riskScore?: number;
  flags?: string[]; // e.g., ['rapid_gifts','geo_mismatch']
}

export interface LedgerTransactionMetadata {
  [key: string]: unknown; // Strict unknown to force narrowing on access
}

export interface LedgerTransaction {
  userId: string;
  kind: TransactionKind;
  asset: AssetCode;
  amount: number; // Positive integer units
  direction: TransactionDirection;
  runningBalance?: number; // Optional accelerator; may be omitted if contention high
  sessionId?: string; // Live session linkage if applicable
  giftTypeId?: string;
  counterpartUserId?: string; // Other party in multi-user events (gift sender/creator)
  correlationId?: string; // Groups related transactions (gift pair, refund chain)
  idempotencyKey?: string; // Ensures at-most-once semantics for client retried ops
  status?: 'final' | 'pending';
  purchase?: LedgerTransactionPurchaseMeta;
  withdrawal?: LedgerTransactionWithdrawalMeta;
  refundOfTransactionId?: string; // Points to original txn being reversed
  adjustmentReasonCode?: string; // Admin/manual adjustment classification
  fraud?: LedgerTransactionFraudMeta;
  createdAt: TS;
  createdBy: 'system' | 'user' | 'admin';
  metadata?: LedgerTransactionMetadata; // Extensible key-value bag
}

export interface Wallet {
  userId: string;
  balanceCoins: number; // Derived from ledger events (credit - debit)
  balanceGems: number;  // Parallel asset balance
  lastLedgerTxnId?: string; // Pointer to most recent applied transaction
  createdAt: TS;
  updatedAt: TS;
  shardCount?: number; // Planned horizontal sharding / distributed counters support
}
