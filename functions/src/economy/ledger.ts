import * as admin from 'firebase-admin';

import { initFirebaseAdmin } from '../firebaseAdmin';

// Initialize admin app if not already (defensive; real project may initialize elsewhere)
initFirebaseAdmin();

const db = admin.firestore();

// Lightweight copies of shared types (avoid cross-package import complexity in initial scaffold)
export type TransactionKind =
  | 'purchase'
  | 'gift_send'
  | 'gift_receive'
  | 'earning'
  | 'refund'
  | 'withdrawal_request'
  | 'withdrawal_settlement'
  | 'adjustment';

export type TransactionDirection = 'debit' | 'credit';
export type AssetCode = 'coin' | 'gem';

export interface LedgerTransactionInput {
  userId: string;
  kind: TransactionKind;
  asset: AssetCode; // Phase A focus: 'coin'
  amount: number; // Positive integer
  direction: TransactionDirection;
  idempotencyKey?: string;
  correlationId?: string;
  sessionId?: string;
  giftTypeId?: string;
  counterpartUserId?: string;
  metadata?: Record<string, unknown>;
  createdBy: 'system' | 'user' | 'admin';
}

export interface WalletDoc {
  userId: string;
  balanceCoins: number;
  balanceGems: number;
  lastLedgerTxnId?: string;
  shardCount?: number; // For future distributed counters
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
}

export interface ProcessLedgerResult {
  transactionId: string;
  newBalanceCoins: number;
  existing?: boolean; // true if returned existing idempotent txn
}

// Collection references
const LEDGER_COL = 'ledgerTransactions';
const WALLETS_COL = 'wallets';

// Helper to locate existing transaction by idempotencyKey
async function findExistingByIdempotency(userId: string, key: string) {
  const snap = await db
    .collection(LEDGER_COL)
    .where('userId', '==', userId)
    .where('idempotencyKey', '==', key)
    .limit(1)
    .get();
  if (!snap.empty) {
    const doc = snap.docs[0];
    return { id: doc.id, data: doc.data() };
  }
  return undefined;
}

export async function processLedgerTransaction(
  transactionData: LedgerTransactionInput
): Promise<ProcessLedgerResult> {
  if (transactionData.amount <= 0 || !Number.isInteger(transactionData.amount)) {
    throw new Error('Amount must be a positive integer');
  }
  if (transactionData.asset !== 'coin') {
    // Phase A: focus on coins; gems can be added with parallel logic later
    throw new Error('Only coin asset supported in Phase A implementation');
  }

  // Idempotency pre-check (best-effort outside transaction to avoid unnecessary retries)
  if (transactionData.idempotencyKey) {
    const existing = await findExistingByIdempotency(
      transactionData.userId,
      transactionData.idempotencyKey
    );
    if (existing) {
      return {
        transactionId: existing.id,
        newBalanceCoins: existing.data.runningBalance ?? existing.data.balanceAfter ?? 0,
        existing: true,
      };
    }
  }

  const walletRef = db.collection(WALLETS_COL).doc(transactionData.userId);
  const ledgerRef = db.collection(LEDGER_COL).doc(); // Generate new id
  const now = admin.firestore.Timestamp.now();

  const result = await db.runTransaction(async (tx) => {
    // Re-check idempotency inside transaction (race-safe)
    if (transactionData.idempotencyKey) {
      const dupSnap = await tx.get(
        db
          .collection(LEDGER_COL)
          .where('userId', '==', transactionData.userId)
          .where('idempotencyKey', '==', transactionData.idempotencyKey)
          .limit(1)
      );
      if (!dupSnap.empty) {
        const doc = dupSnap.docs[0];
        const data = doc.data();
        return {
          transactionId: doc.id,
          newBalanceCoins: data.runningBalance ?? data.balanceAfter ?? 0,
          existing: true,
        } as ProcessLedgerResult;
      }
    }

    // Load or initialize wallet
    let walletDoc: WalletDoc | undefined;
    const walletSnap = await tx.get(walletRef);
    if (walletSnap.exists) {
      walletDoc = walletSnap.data() as WalletDoc;
    } else {
      walletDoc = {
        userId: transactionData.userId,
        balanceCoins: 0,
        balanceGems: 0,
        createdAt: now,
        updatedAt: now,
      };
      tx.set(walletRef, walletDoc);
    }

    // Sharding guard
    if (walletDoc.shardCount && walletDoc.shardCount > 0) {
      throw new Error('Distributed counters not yet implemented');
    }

    // Debit validation
    const currentBalance = walletDoc.balanceCoins;
    const delta = transactionData.direction === 'credit' ? transactionData.amount : -transactionData.amount;
    if (transactionData.direction === 'debit') {
      if (currentBalance < transactionData.amount) {
        throw new Error('Insufficient funds');
      }
    }
    const newBalance = currentBalance + delta;

    // Prepare ledger doc body. Optional fields are only included when defined —
    // Firestore rejects `undefined` values (e.g. a daily-reward earning has no
    // correlationId/sessionId/giftTypeId/counterpartUserId), which previously
    // threw inside the transaction and failed the whole claim with a 500.
    const ledgerBody: Record<string, unknown> = {
      userId: transactionData.userId,
      kind: transactionData.kind,
      asset: transactionData.asset,
      amount: transactionData.amount,
      direction: transactionData.direction,
      runningBalance: newBalance, // Accelerator; can be removed if contention high
      metadata: transactionData.metadata ?? {},
      createdAt: now,
      createdBy: transactionData.createdBy,
    };
    if (transactionData.idempotencyKey !== undefined) ledgerBody.idempotencyKey = transactionData.idempotencyKey;
    if (transactionData.correlationId !== undefined) ledgerBody.correlationId = transactionData.correlationId;
    if (transactionData.sessionId !== undefined) ledgerBody.sessionId = transactionData.sessionId;
    if (transactionData.giftTypeId !== undefined) ledgerBody.giftTypeId = transactionData.giftTypeId;
    if (transactionData.counterpartUserId !== undefined) ledgerBody.counterpartUserId = transactionData.counterpartUserId;

    tx.set(ledgerRef, ledgerBody);

    // Update wallet
    tx.update(walletRef, {
      balanceCoins: newBalance,
      lastLedgerTxnId: ledgerRef.id,
      updatedAt: now,
    });

    return {
      transactionId: ledgerRef.id,
      newBalanceCoins: newBalance,
    } as ProcessLedgerResult;
  });

  return result;
}

// Export for potential future batch usage
export default { processLedgerTransaction };
