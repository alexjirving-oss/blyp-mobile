import type {
  Grid9ClientIntentType,
  Grid9ErrorCode,
  Grid9ServerEventType,
} from './protocol';
import type { Grid9SlotIndex } from './constants';
import type { Grid9LedgerReceipt } from './ledger';

const SAFE_KEY_PART = /^[A-Za-z0-9._-]{1,160}$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;

export const GRID9_QUEUE_ENTRY_TTL_SECONDS = 5 * 60;
export const GRID9_ASSIGNMENT_TTL_SECONDS = 30;
export const GRID9_PRESENCE_TTL_SECONDS = 45;

function keyPart(value: string, label: string): string {
  if (!SAFE_KEY_PART.test(value)) {
    throw new TypeError(`${label} contains unsupported Redis key characters`);
  }
  return value;
}

function nonceDigestPart(value: string): string {
  if (!SHA256_HEX.test(value)) {
    throw new TypeError('nonceDigest must be a lowercase SHA-256 hex digest');
  }
  return value;
}

function matchHashTag(matchId: string): string {
  return `{${keyPart(matchId, 'matchId')}}`;
}

function regionHashTag(region: string): string {
  return `{${keyPart(region, 'region')}}`;
}

export const grid9RedisKeys = {
  matchAggregate(matchId: string): string {
    return `grid9:${matchHashTag(matchId)}:aggregate`;
  },
  matchLock(matchId: string): string {
    return `grid9:${matchHashTag(matchId)}:lock`;
  },
  ledgerProjection(matchId: string): string {
    return `grid9:${matchHashTag(matchId)}:ledger-projection`;
  },
  presence(matchId: string): string {
    return `grid9:${matchHashTag(matchId)}:presence`;
  },
  presenceUser(matchId: string, userId: string): string {
    return `grid9:${matchHashTag(matchId)}:presence:${keyPart(userId, 'userId')}`;
  },
  presenceIndex(matchId: string): string {
    return `grid9:${matchHashTag(matchId)}:presence-index`;
  },
  presenceTimeouts(): string {
    return 'grid9:presence-timeouts';
  },
  presenceTimeoutMember(matchId: string, userId: string): string {
    return `${keyPart(matchId, 'matchId')}|${keyPart(userId, 'userId')}`;
  },
  regionalAggregate(region: string): string {
    return `grid9:${regionHashTag(region)}:regional-aggregate`;
  },
  regionalLock(region: string): string {
    return `grid9:${regionHashTag(region)}:regional-lock`;
  },
  queue(region: string): string {
    return `grid9:${regionHashTag(region)}:queue`;
  },
  queueEntry(region: string, ticketId: string): string {
    return `grid9:${regionHashTag(region)}:queue-entry:${keyPart(ticketId, 'ticketId')}`;
  },
  assignment(region: string, assignmentId: string): string {
    return `grid9:${regionHashTag(region)}:assignment:${keyPart(assignmentId, 'assignmentId')}`;
  },
  connectionNonce(connectionSessionId: string, nonceDigest: string): string {
    return `grid9:connection:${keyPart(connectionSessionId, 'connectionSessionId')}:nonce:${nonceDigestPart(nonceDigest)}`;
  },
  timersProjection(): string {
    return 'grid9:timers-projection';
  },
  activeMatches(): string {
    return 'grid9:active-matches';
  },
  userMatch(userId: string): string {
    return `grid9:user-match:${keyPart(userId, 'userId')}`;
  },
} as const;

export const grid9AggregateFields = {
  state: 'state',
  sequence: 'sequence',
  escrow(userId: string): string {
    return `escrow:${keyPart(userId, 'userId')}`;
  },
  nonce(userId: string, nonceDigest: string): string {
    return `nonce:${keyPart(userId, 'userId')}:${nonceDigestPart(nonceDigest)}`;
  },
  intent(userId: string, intentId: string): string {
    return `intent:${keyPart(userId, 'userId')}:${keyPart(intentId, 'intentId')}`;
  },
  operation(operationId: string): string {
    return `operation:${keyPart(operationId, 'operationId')}`;
  },
  ledger(entryId: string): string {
    return `ledger:${keyPart(entryId, 'entryId')}`;
  },
  settlement(settlementId: string): string {
    return `settlement:${keyPart(settlementId, 'settlementId')}`;
  },
  timerOutbox(stateVersion: number): string {
    if (!Number.isSafeInteger(stateVersion) || stateVersion < 0) {
      throw new TypeError('stateVersion must be a non-negative safe integer');
    }
    return `timer-outbox:${stateVersion}`;
  },
} as const;

export const grid9RegionalAggregateFields = {
  rollover: 'rollover',
  connectionNonce(connectionSessionId: string, nonceDigest: string): string {
    return `nonce:${keyPart(connectionSessionId, 'connectionSessionId')}:${nonceDigestPart(nonceDigest)}`;
  },
  connectionIntent(userId: string, intentId: string): string {
    return `intent:${keyPart(userId, 'userId')}:${keyPart(intentId, 'intentId')}`;
  },
  matchmakingClaim(ticketId: string): string {
    return `matchmaking:${keyPart(ticketId, 'ticketId')}`;
  },
  rolloverClaim(claimId: string): string {
    return `rollover-claim:${keyPart(claimId, 'claimId')}`;
  },
  settlementReceipt(settlementId: string): string {
    return `settlement:${keyPart(settlementId, 'settlementId')}`;
  },
  sponsorPass(passId: string): string {
    return `sponsor-pass:${keyPart(passId, 'passId')}`;
  },
} as const;

export interface Grid9ConsumedNonceRecord {
  schemaVersion: 1;
  nonceDigest: string;
  intentId: string;
  userId: string;
  connectionSessionId: string;
  consumedAt: string;
}

export interface Grid9IntentReceiptRecord {
  schemaVersion: 1;
  intentId: string;
  matchId: string | null;
  userId: string;
  commandType: Grid9ClientIntentType;
  canonicalIntentHash: string;
  status: 'pending' | 'committed' | 'rejected';
  stateVersion: number | null;
  ledgerEntryId: string | null;
  privateReceipt: Grid9LedgerReceipt | null;
  errorCode: Grid9ErrorCode | null;
  serverMessageId: string;
  replayEvent: {
    type: Grid9ServerEventType;
    messageId: string;
    payloadJson: string;
    stateVersion: number | null;
    sequence: number | null;
  };
  recordedAt: string;
}

export interface Grid9PresenceEntry {
  schemaVersion: 1;
  connectionId: string;
  userId: string | null;
  role: 'player' | 'audience';
  slotIndex: Grid9SlotIndex | null;
  connectedAt: string;
  lastSeenAt: string;
}

export interface Grid9TimerOutboxRecord {
  schemaVersion: 1;
  matchId: string;
  stateVersion: number;
  dueAt: string;
  reason:
    | 'sentinel_fill'
    | 'countdown_end'
    | 'micro_drop'
    | 'turn_end'
    | 'match_deadline';
  projectedAt: string | null;
}

export interface Grid9MatchAssignment {
  schemaVersion: 1;
  assignmentId: string;
  region: string;
  assignmentTokenHash: string;
  matchId: string;
  liveSessionId: string;
  ticketId: string;
  userId: string;
  connectionSessionId: string;
  sponsorPassId: string | null;
  slotIndex: Grid9SlotIndex;
  issuedAt: string;
  expiresAt: string;
  consumedAt: string | null;
}
