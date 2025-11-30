/**
 * Canonical Economy Model & Safety Flags
 * Stage 2.2 – Central definition for wallets, transactions, gifts and purchase gating.
 *
 * DO NOT hard-code collection names outside this module.
 * Use exported constants + flags.
 */

import type { Timestamp } from 'firebase/firestore';

// Collection constants (mirror existing usage observed in services)
export const WALLETS_COLLECTION = 'wallets';
export const TRANSACTIONS_COLLECTION = 'transactions';
export const GIFTS_COLLECTION = 'gifts';
export const GEMS_COLLECTION = 'gems';

// Environment helper
const env: Record<string, string | undefined> = (typeof process !== 'undefined' && process?.env) ? process.env : {};
function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = env[name];
  if (raw === undefined) return defaultValue;
  return raw === '1' || raw === 'true';
}

// Safety / feature flags (dev-friendly defaults preserve current behaviour)
// In production we will invert some defaults via config.
export const ENABLE_PURCHASES = !envFlag('EXPO_PUBLIC_DISABLE_PURCHASES', false); // default true
export const ENABLE_WITHDRAWALS = envFlag('EXPO_PUBLIC_ENABLE_WITHDRAWALS', false); // not implemented yet
export const ALLOW_SIMULATED_CLIENT_TOPUPS = !envFlag('EXPO_PUBLIC_DISABLE_SIMULATED_TOPUPS', false); // default true
export const REQUIRE_SERVER_RECEIPT_VALIDATION = envFlag('EXPO_PUBLIC_REQUIRE_SERVER_RECEIPT_VALIDATION', false); // default false

// Helper: determine unsafe simulation mode (client credits without server receipt)
export function isUnsafeSimulationMode(): boolean {
  return ENABLE_PURCHASES && ALLOW_SIMULATED_CLIENT_TOPUPS && !REQUIRE_SERVER_RECEIPT_VALIDATION;
}
// TODO(stage2-economy-safety): Flip defaults for production (disable simulation + require server validation).

// Helper: determine if server validation path should be used (Stage 3 hardening)
export function shouldUseServerValidation(): boolean {
  return ENABLE_PURCHASES && REQUIRE_SERVER_RECEIPT_VALIDATION;
}
// TODO(stage3-economy-hardening): For production real-money environments, REQUIRE_SERVER_RECEIPT_VALIDATION should be true.

// Wallet document shape (minimal – only fields currently observed)
export interface WalletDocument {
  balance: number;
  totalEarned?: number;
  totalSpent?: number;
  createdAt?: Timestamp | any;
  lastUpdated?: Timestamp | any;
  userId?: string; // may exist implicitly (doc id is userId)
}

// Gem wallet document (similar to coins)
export interface GemWalletDocument {
  balance: number;
  totalEarned?: number;
  totalSpent?: number;
  createdAt?: Timestamp | any;
  lastUpdated?: Timestamp | any;
  userId?: string;
}

// Transaction document shape (coins + gems share collection)
export interface TransactionDocument {
  userId: string;
  type: 'credit' | 'debit';
  amount: number;
  reason: string; // e.g. purchase | gift_sent | gift_received | daily_reward | grant | spend
  balance: number; // resulting balance after transaction
  asset?: 'coin' | 'gem'; // gem service adds this
  timestamp: Timestamp | any;
  metadata?: Record<string, any>;
}

// Stage 3.2 Ledger groundwork types
export type LedgerEntryType =
  | 'coin_purchase'
  | 'gem_purchase'
  | 'gift_send'
  | 'gift_receive'
  | 'daily_reward'
  | 'adjustment'
  | 'withdrawal';

export interface LedgerEntry {
  id?: string; // Firestore doc id (optional)
  userId: string;
  ledgerType: LedgerEntryType; // Distinct from legacy transaction 'type' (credit/debit)
  amount: number; // always positive; direction implied by ledgerType or paired credit/debit entries
  currency: 'COIN' | 'GEM' | 'FIAT';
  createdAt?: Timestamp | any;
  relatedUserId?: string; // counterparty for gifts
  streamId?: string;
  giftType?: string;
  productId?: string;
  source?: 'store' | 'live' | 'admin';
  reason?: string; // mirrors existing transaction reason where applicable
  idempotencyKey?: string; // future external purchase dedupe
  metadata?: Record<string, any>;
}

export function buildIdempotencyKey(input: {
  userId: string;
  ledgerType: LedgerEntryType;
  productId?: string;
  purchaseToken?: string;
}): string | undefined {
  // TODO(stage3-economy-ledger): Implement stable idempotency key for external purchases.
  return undefined;
}

// Placeholder aggregation helper (not used yet)
export function deriveWalletBalanceFromLedger(entries: LedgerEntry[]): { coins: number; gems: number } {
  // TODO(stage3-economy-ledger): Implement proper aggregation from ledger entries.
  return { coins: 0, gems: 0 };
}

// Gift record (from BlypCoinService.sendGift)
export interface GiftRecord {
  fromUserId: string;
  toUserId: string;
  giftType: string;
  cost: number;
  receiverAmount: number;
  timestamp: Timestamp | any;
  status: string; // completed, failed, etc.
}

// Central runtime summary (diagnostics)
export const economyRuntimeSummary = {
  ENABLE_PURCHASES,
  ENABLE_WITHDRAWALS,
  ALLOW_SIMULATED_CLIENT_TOPUPS,
  REQUIRE_SERVER_RECEIPT_VALIDATION,
  isUnsafeSimulationMode: isUnsafeSimulationMode(),
  collections: {
    WALLETS_COLLECTION,
    TRANSACTIONS_COLLECTION,
    GIFTS_COLLECTION,
    GEMS_COLLECTION,
  }
};

// TODO(stage2-economy-safety): Introduce immutable ledger + derive wallet state from aggregated transactions.
// TODO(stage2-economy-safety): Add withdrawal flow + server-side verification logic.
// TODO(stage2-economy-safety): Add fraud/velocity checks for gifts & purchases.

