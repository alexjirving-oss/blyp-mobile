import type { Grid9ArsenalItemId } from './catalog';
import type { Grid9SlotIndex } from './constants';
import type { Grid9SentinelTargetStrategy } from './players';

export type Grid9EscrowStatus = 'open' | 'settling' | 'settled' | 'frozen';

export interface Grid9EscrowWallet {
  schemaVersion: 1;
  matchId: string;
  userId: string;
  currency: 'coins';
  status: Grid9EscrowStatus;
  platformReservedCoins: number;
  microDropCreditCoins: number;
  availableCoins: number;
  spentCoins: number;
  spentPlatformCoins: number;
  spentMicroDropCoins: number;
  refundedCoins: number;
  refundedPlatformCoins: number;
  refundedMicroDropCoins: number;
  releasedCoins: number;
  expiredMicroDropCoins: number;
  reservationIds: string[];
  version: number;
  openedAt: string;
  updatedAt: string;
  settledAt: string | null;
}

export interface Grid9WalletReservationRecord {
  schemaVersion: 1;
  reservationId: string;
  idempotencyKey: string;
  matchId: string;
  userId: string;
  amountCoins: number;
  platformLedgerEntryId: string;
  capturedCoins: number;
  releasedCoins: number;
  status: 'reserved' | 'partially_settled' | 'settled';
  createdAt: string;
  updatedAt: string;
}

export type Grid9LedgerFundingSource =
  | 'platform_wallet_reservation'
  | 'actor_escrow'
  | 'mercenary_bankroll'
  | 'house_micro_drop'
  | 'jackpot_pool'
  | 'inventory'
  | 'free_drop';

export interface Grid9LedgerFundingBreakdown {
  platformReservationCoins: number;
  microDropCoins: number;
  mercenaryBankrollCoins: number;
  jackpotPoolCoins: number;
}

export interface Grid9EscrowSpendAllocation {
  amountCoins: number;
  microDropCoins: number;
  platformReservationCoins: number;
}

export function allocateGrid9EscrowSpend(
  wallet: Grid9EscrowWallet,
  amountCoins: number,
): Grid9EscrowSpendAllocation {
  if (!Number.isSafeInteger(amountCoins) || amountCoins <= 0) {
    throw new RangeError('amountCoins must be a positive safe integer');
  }
  if (wallet.status !== 'open') {
    throw new Error('Grid 9 escrow is not open for spending');
  }

  const netMicroDropSpent =
    wallet.spentMicroDropCoins - wallet.refundedMicroDropCoins;
  const netPlatformSpent =
    wallet.spentPlatformCoins - wallet.refundedPlatformCoins;
  const microDropAvailable = Math.max(
    0,
    wallet.microDropCreditCoins -
      netMicroDropSpent -
      wallet.expiredMicroDropCoins,
  );
  const platformAvailable = Math.max(
    0,
    wallet.platformReservedCoins -
      netPlatformSpent -
      wallet.releasedCoins,
  );
  if (microDropAvailable + platformAvailable !== wallet.availableCoins) {
    throw new Error('Grid 9 escrow source totals do not match availableCoins');
  }
  if (amountCoins > wallet.availableCoins) {
    throw new RangeError('insufficient Grid 9 escrow funds');
  }

  const microDropCoins = Math.min(amountCoins, microDropAvailable);
  return {
    amountCoins,
    microDropCoins,
    platformReservationCoins: amountCoins - microDropCoins,
  };
}

export type Grid9LedgerEntryKind =
  | 'escrow_reserved'
  | 'weapon_purchase'
  | 'shield_purchase'
  | 'mercenary_funding'
  | 'arsenal_gift'
  | 'inventory_buy'
  | 'micro_drop_credit'
  | 'action_refund'
  | 'jackpot_payout'
  | 'jackpot_rollover'
  | 'escrow_release';

export interface Grid9LedgerEntry {
  schemaVersion: 1;
  entryId: string;
  intentId: string | null;
  matchId: string;
  kind: Grid9LedgerEntryKind;
  actorUserId: string | null;
  beneficiaryUserId: string | null;
  sourceSlotIndex: Grid9SlotIndex | null;
  targetSlotIndex: Grid9SlotIndex | null;
  itemId: Grid9ArsenalItemId | null;
  fundingSource: Grid9LedgerFundingSource;
  fundingBreakdown: Grid9LedgerFundingBreakdown;
  serverOperationId: string | null;
  canonicalPayloadHash: string;
  debitCoins: number;
  creditCoins: number;
  jackpotDeltaCoins: number;
  escrowBalanceBefore: number | null;
  escrowBalanceAfter: number | null;
  stateVersionBefore: number;
  stateVersionAfter: number;
  createdAt: string;
}

export interface Grid9LedgerReceipt {
  entryId: string;
  intentId: string;
  kind: Grid9LedgerEntryKind;
  debitCoins: number;
  creditCoins: number;
  jackpotContributionCoins: number;
  availableCoinsAfter: number | null;
  stateVersion: number;
  committedAt: string;
}

export interface Grid9PublicPurchaseReceipt {
  entryId: string;
  intentId: string | null;
  serverOperationId: string | null;
  itemId: Grid9ArsenalItemId | null;
  debitCoins: number;
  jackpotContributionCoins: number;
  stateVersion: number;
  committedAt: string;
}

export interface Grid9ProxyPurchaseOperation {
  schemaVersion: 1;
  operationId: string;
  canonicalOperationHash: string;
  matchId: string;
  turnNumber: number;
  sourceSlotIndex: Grid9SlotIndex;
  targetSlotIndex: Grid9SlotIndex;
  itemId: Grid9ArsenalItemId;
  bankrollBefore: number;
  bankrollAfter: number;
  stateVersionBefore: number;
  requestedAt: string;
}

export interface Grid9SentinelPurchaseOperation {
  schemaVersion: 1;
  operationId: string;
  canonicalOperationHash: string;
  matchId: string;
  turnNumber: number;
  sentinelId: string;
  sourceSlotIndex: Grid9SlotIndex;
  targetSlotIndex: Grid9SlotIndex;
  itemId: Grid9ArsenalItemId;
  fundingSource: 'mercenary_bankroll';
  bankrollOrigin: 'micro_drop' | 'sponsor_funding' | 'mixed';
  targetStrategy: Grid9SentinelTargetStrategy;
  bankrollBefore: number;
  bankrollAfter: number;
  stateVersionBefore: number;
  requestedAt: string;
}

export interface Grid9MercenarySpendAllocation {
  amountCoins: number;
  microDropCoins: number;
  sponsorCoins: number;
  origin: 'micro_drop' | 'sponsor_funding' | 'mixed';
}

export function allocateGrid9MercenarySpend(args: {
  sponsorCoins: number;
  microDropCoins: number;
  amountCoins: number;
}): Grid9MercenarySpendAllocation {
  for (const [label, value] of Object.entries(args)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`${label} must be a non-negative safe integer`);
    }
  }
  if (args.amountCoins === 0) {
    throw new RangeError('amountCoins must be greater than zero');
  }
  if (args.amountCoins > args.sponsorCoins + args.microDropCoins) {
    throw new RangeError('insufficient mercenary bankroll');
  }
  const microDropCoins = Math.min(args.amountCoins, args.microDropCoins);
  const sponsorCoins = args.amountCoins - microDropCoins;
  return {
    amountCoins: args.amountCoins,
    microDropCoins,
    sponsorCoins,
    origin:
      microDropCoins > 0 && sponsorCoins > 0
        ? 'mixed'
        : microDropCoins > 0
          ? 'micro_drop'
          : 'sponsor_funding',
  };
}

export interface Grid9ServerOperationReceipt {
  schemaVersion: 1;
  operationId: string;
  canonicalOperationHash: string;
  matchId: string;
  kind:
    | 'escrow_reservation'
    | 'proxy_purchase'
    | 'sentinel_purchase'
    | 'micro_drop'
    | 'turn_advance'
    | 'phase_transition'
    | 'connection_state'
    | 'match_settlement';
  status: 'committed' | 'rejected';
  stateVersion: number;
  ledgerEntryId: string | null;
  resultJson: string;
  recordedAt: string;
}

export type Grid9SettlementStatus =
  | 'not_started'
  | 'pending'
  | 'completed'
  | 'failed_retryable'
  | 'failed_terminal';

export interface Grid9SettlementState {
  status: Grid9SettlementStatus;
  settlementId: string | null;
  winnerPayoutCoins: number;
  rolloverCoins: number;
  escrowReleaseCoins: number;
  attemptCount: number;
  lastAttemptAt: string | null;
  completedAt: string | null;
  errorCode: string | null;
}

export interface Grid9EscrowReleaseInstruction {
  reservationId: string;
  userId: string;
  releasePlatformCoins: number;
  capturePlatformCoins: number;
  expireMicroDropCoins: number;
}

export interface Grid9SettlementOutboxRecord {
  schemaVersion: 1;
  settlementId: string;
  idempotencyKey: string;
  matchId: string;
  region: string;
  outcome: 'human_payout' | 'sentinel_rollover' | 'cancelled_release';
  winnerUserId: string | null;
  payoutCoins: number;
  rolloverCoins: number;
  sponsorPassId: string | null;
  sponsorPassUserId: string | null;
  escrowReleases: Grid9EscrowReleaseInstruction[];
  status: 'pending' | 'claimed' | 'applied' | 'failed_retryable' | 'failed_terminal';
  claimId: string | null;
  claimedAt: string | null;
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
  appliedAt: string | null;
  errorCode: string | null;
}

export interface Grid9RegionalSettlementReceipt {
  schemaVersion: 1;
  settlementId: string;
  matchId: string;
  region: string;
  rolloverCoinsBefore: number;
  rolloverCoinsAfter: number;
  sponsorPassId: string | null;
  appliedAt: string;
}
