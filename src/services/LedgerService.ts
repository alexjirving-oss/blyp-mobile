/**
 * LedgerService – Stage 3.2 groundwork
 * Wraps transaction writes, adding a ledgerType field while preserving existing transaction shape.
 */
// @ts-ignore JS config without TS typing; casting to Firestore handled below.
import { firestore as rawDb } from '../config/firebase';
import { serverTimestamp, doc, collection, setDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { TRANSACTIONS_COLLECTION, LedgerEntry } from '../config/economyModel';

// @ts-ignore rawDb originates from JS module lacking types
const db: Firestore = rawDb as Firestore; // Cast for TypeScript since config is JS.

// Append outside a Firestore transaction (legacy behaviour equivalent to addDoc)
export async function appendLedgerEntry(entry: LedgerEntry & { txType?: 'credit' | 'debit'; balance?: number }) {
  const { userId, ledgerType, amount, currency } = entry;
  if (!userId || !ledgerType || !currency || typeof amount !== 'number') {
    console.warn('[LEDGER] Invalid ledger entry payload', entry);
    return null;
  }
  const payload = {
    userId,
    ledgerType,
    amount,
    currency,
    // Preserve legacy transaction fields if provided
    type: entry.txType || (ledgerType === 'gift_send' || ledgerType === 'adjustment' ? 'debit' : 'credit'),
    reason: entry.reason || ledgerType,
    balance: entry.balance ?? undefined,
    asset: currency === 'COIN' ? 'coin' : currency === 'GEM' ? 'gem' : undefined,
    timestamp: serverTimestamp(),
    metadata: entry.metadata || {},
    relatedUserId: entry.relatedUserId,
    streamId: entry.streamId,
    productId: entry.productId,
    giftType: entry.giftType,
    source: entry.source,
    idempotencyKey: entry.idempotencyKey
  };
  const ref = doc(collection(db, TRANSACTIONS_COLLECTION));
  await setDoc(ref, payload);
  return ref.id;
}

// Append using an existing Firestore transaction for atomic wallet+ledger updates.
export function appendLedgerEntryViaTransaction(transaction: any, entry: LedgerEntry & { txType: 'credit' | 'debit'; balance: number }) {
  const { userId, ledgerType, amount, currency } = entry;
  if (!transaction) throw new Error('Transaction object required');
  if (!userId || !ledgerType || !currency || typeof amount !== 'number') {
    console.warn('[LEDGER] Invalid ledger entry (tx) payload', entry);
    return;
  }
  const ref = doc(collection(db, TRANSACTIONS_COLLECTION));
  transaction.set(ref, {
    userId,
    ledgerType,
    amount,
    currency,
    type: entry.txType, // preserve original credit/debit
    reason: entry.reason || ledgerType,
    balance: entry.balance,
    asset: currency === 'COIN' ? 'coin' : currency === 'GEM' ? 'gem' : undefined,
    timestamp: serverTimestamp(),
    metadata: entry.metadata || {},
    relatedUserId: entry.relatedUserId,
    streamId: entry.streamId,
    productId: entry.productId,
    giftType: entry.giftType,
    source: entry.source,
    idempotencyKey: entry.idempotencyKey
  });
}

// TODO(stage3-economy-ledger): Enforce idempotencyKey for external purchases (avoid double-credit).
// TODO(stage3-economy-ledger): Support partitioned storage or per-user subcollections for scalability.
