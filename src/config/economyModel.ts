/**
 * Canonical Economy Model & Safety Flags
 * Stage 2.2 – Central definition for wallets, transactions, gifts and purchase gating.
 *
 * DO NOT hard-code collection names outside this module.
 * Use exported constants + flags.
 */

import type { Timestamp } from 'firebase/firestore';

// Import __DEV__ constant from React Native
// @ts-ignore (React Native global)
declare const __DEV__: boolean;

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

// ============================================================================
// ECONOMY SAFETY FLAGS
// ============================================================================
// 
// PRODUCTION MODE (default):
// - ENABLE_PURCHASES: true if backend is ready, false if not
// - ALLOW_SIMULATED_CLIENT_TOPUPS: false (no client-side credits without server validation)
// - REQUIRE_SERVER_RECEIPT_VALIDATION: true (all purchases must be validated server-side)
// - ENABLE_WITHDRAWALS: false (not implemented, disabled until backend ready)
//
// DEVELOPMENT MODE (with EXPO_PUBLIC_DEV_MODE=1):
// - ALLOW_SIMULATED_CLIENT_TOPUPS: true (for testing without billing backend)
// - REQUIRE_SERVER_RECEIPT_VALIDATION: false (for testing with mock tokens)
// - ENABLE_WITHDRAWALS: false (always off until implemented)
//
// ============================================================================

const IS_DEV = __DEV__ === true;

// Determine if we're in development mode by checking environment
const isDevelopment = IS_DEV || (typeof process !== 'undefined' && process?.env?.EXPO_PUBLIC_DEV_MODE === '1');

// PRODUCTION-SAFE DEFAULTS
// In production, simulate = false and server validation = true
// In dev, we allow simulated topups for testing without real billing
export const ALLOW_SIMULATED_CLIENT_TOPUPS = isDevelopment && 
  !envFlag('EXPO_PUBLIC_DISABLE_SIMULATED_TOPUPS', false);  // default false in prod

// Server validation should be true in production; only disabled in dev for testing
export const REQUIRE_SERVER_RECEIPT_VALIDATION = !isDevelopment || 
  envFlag('EXPO_PUBLIC_REQUIRE_SERVER_RECEIPT_VALIDATION', false);  // default true in prod

// Purchases only enabled if backend is configured (never in prod without backend)
export const ENABLE_PURCHASES = !envFlag('EXPO_PUBLIC_DISABLE_PURCHASES', false);  // default true unless explicitly disabled

// Legacy Firestore mutation gate (separate from live-service wallet operations).
// Keep default dev-friendly and prod-safe: enabled in dev, disabled in prod unless explicitly opted in.
const CLIENT_ECONOMY_MUTATIONS_ENABLED = envFlag('EXPO_PUBLIC_ECONOMY_MUTATIONS_ENABLED', isDevelopment);

export function isClientEconomyMutationAllowed(): boolean {
  return CLIENT_ECONOMY_MUTATIONS_ENABLED;
}

// Withdrawals: on by default once Stripe Connect backend is deployed; set
// EXPO_PUBLIC_ENABLE_WITHDRAWALS=0 to force-hide the client CTA.
export const ENABLE_WITHDRAWALS = envFlag('EXPO_PUBLIC_ENABLE_WITHDRAWALS', true);

// Helper: determine unsafe simulation mode (client credits without server receipt)
// In production, this should ALWAYS be false
export function isUnsafeSimulationMode(): boolean {
  if (!isDevelopment) {
    // In production, unsafe simulation MUST be false
    return false;
  }
  // In dev, check if both simulation is allowed AND server validation is NOT required
  return ENABLE_PURCHASES && ALLOW_SIMULATED_CLIENT_TOPUPS && !REQUIRE_SERVER_RECEIPT_VALIDATION;
}

// Helper: determine if server validation path should be used
export function shouldUseServerValidation(): boolean {
  return REQUIRE_SERVER_RECEIPT_VALIDATION;
}

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

