// Live Streaming Unified Model Types (Phase A)
// Mirrors target spec for LiveSession, StreamSegment, GiftEvent.

export type TS = Date; // Timestamp alias

export interface StreamHealth {
  lastSegmentAt: TS;
  stalled: boolean;
  errorCodes: string[];
  avgSegmentIngestMs?: number;
}

export interface LiveSessionEconomySnapshot {
  totalCoinsEarned: number;
  giftEvents: number; // Count of gift events
}

export interface LiveSessionModerationState {
  isSuspended: boolean;
  activeModerationFlags: string[]; // e.g., ['spam_detected']
}

export interface LiveSessionAnalyticsCounters {
  joinCount: number;
  chatMessageCount: number;
  giftCount: number;
}

export type LiveSessionStatus = 'active' | 'ended' | 'error' | 'starting';

export interface LiveSession {
  creatorUserId: string;
  status: LiveSessionStatus;
  startedAt: TS;
  endedAt?: TS;
  currentSegmentIndex: number;
  segmentWindowSize: number;
  viewerCount: number;
  totalUniqueViewers: number; // Approx distinct (future HLL)
  streamHealth: StreamHealth;
  economy: LiveSessionEconomySnapshot;
  moderation: LiveSessionModerationState;
  analytics: LiveSessionAnalyticsCounters;
  version: number;
  createdAt: TS;
  updatedAt: TS;
}

export interface TranscodedVariantMeta {
  path: string; // streams/{sessionId}/{variantId}/{index}.ts
  bitrateKbps: number;
  width: number;
  height: number;
}

export interface StreamSegmentTranscodedState {
  variants: { [variantId: string]: TranscodedVariantMeta };
  status: 'pending' | 'transcoding' | 'ready' | 'error';
}

export interface StreamSegment {
  index: number; // Sequential index
  uploadedAt: TS;
  durationSeconds: number;
  storagePath: string; // streams/{sessionId}/source/{index}.ts
  byteSize: number;
  checksum?: string;
  transcoded: StreamSegmentTranscodedState;
  purgeEligible: boolean;
  errors?: string[];
}

export interface GiftLedgerRefIds {
  debitSender: string; // ledgerTransactions id for sender debit
  creditCreator: string; // ledgerTransactions id for creator credit
}

export interface GiftEventMetadata {
  platformFeePercent?: number;
  [key: string]: unknown;
}

export interface GiftEvent {
  sessionId: string;
  senderUserId: string;
  creatorUserId: string;
  giftTypeId: string;
  giftVersion: number;
  coinsSpent: number;
  coinsCredited: number;
  ledgerTransactionIds: GiftLedgerRefIds;
  clientEventId?: string; // Idempotency key from client
  createdAt: TS;
  animationRef?: string;
  metadata?: GiftEventMetadata;
}
