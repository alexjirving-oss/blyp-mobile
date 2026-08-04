"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.processLedgerTransaction = void 0;
const admin = __importStar(require("firebase-admin"));
const firebaseAdmin_1 = require("../firebaseAdmin");
// Initialize admin app if not already (defensive; real project may initialize elsewhere)
(0, firebaseAdmin_1.initFirebaseAdmin)();
const db = admin.firestore();
// Collection references
const LEDGER_COL = 'ledgerTransactions';
const WALLETS_COL = 'wallets';
// Helper to locate existing transaction by idempotencyKey
async function findExistingByIdempotency(userId, key) {
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
async function processLedgerTransaction(transactionData) {
    var _a, _b;
    if (transactionData.amount <= 0 || !Number.isInteger(transactionData.amount)) {
        throw new Error('Amount must be a positive integer');
    }
    if (transactionData.asset !== 'coin') {
        // Phase A: focus on coins; gems can be added with parallel logic later
        throw new Error('Only coin asset supported in Phase A implementation');
    }
    // Idempotency pre-check (best-effort outside transaction to avoid unnecessary retries)
    if (transactionData.idempotencyKey) {
        const existing = await findExistingByIdempotency(transactionData.userId, transactionData.idempotencyKey);
        if (existing) {
            return {
                transactionId: existing.id,
                newBalanceCoins: (_b = (_a = existing.data.runningBalance) !== null && _a !== void 0 ? _a : existing.data.balanceAfter) !== null && _b !== void 0 ? _b : 0,
                existing: true,
            };
        }
    }
    const walletRef = db.collection(WALLETS_COL).doc(transactionData.userId);
    const ledgerRef = db.collection(LEDGER_COL).doc(); // Generate new id
    const now = admin.firestore.Timestamp.now();
    const result = await db.runTransaction(async (tx) => {
        var _a, _b, _c;
        // Re-check idempotency inside transaction (race-safe)
        if (transactionData.idempotencyKey) {
            const dupSnap = await tx.get(db
                .collection(LEDGER_COL)
                .where('userId', '==', transactionData.userId)
                .where('idempotencyKey', '==', transactionData.idempotencyKey)
                .limit(1));
            if (!dupSnap.empty) {
                const doc = dupSnap.docs[0];
                const data = doc.data();
                return {
                    transactionId: doc.id,
                    newBalanceCoins: (_b = (_a = data.runningBalance) !== null && _a !== void 0 ? _a : data.balanceAfter) !== null && _b !== void 0 ? _b : 0,
                    existing: true,
                };
            }
        }
        // Load or initialize wallet
        let walletDoc;
        const walletSnap = await tx.get(walletRef);
        if (walletSnap.exists) {
            walletDoc = walletSnap.data();
        }
        else {
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
        const ledgerBody = {
            userId: transactionData.userId,
            kind: transactionData.kind,
            asset: transactionData.asset,
            amount: transactionData.amount,
            direction: transactionData.direction,
            runningBalance: newBalance,
            metadata: (_c = transactionData.metadata) !== null && _c !== void 0 ? _c : {},
            createdAt: now,
            createdBy: transactionData.createdBy,
        };
        if (transactionData.idempotencyKey !== undefined)
            ledgerBody.idempotencyKey = transactionData.idempotencyKey;
        if (transactionData.correlationId !== undefined)
            ledgerBody.correlationId = transactionData.correlationId;
        if (transactionData.sessionId !== undefined)
            ledgerBody.sessionId = transactionData.sessionId;
        if (transactionData.giftTypeId !== undefined)
            ledgerBody.giftTypeId = transactionData.giftTypeId;
        if (transactionData.counterpartUserId !== undefined)
            ledgerBody.counterpartUserId = transactionData.counterpartUserId;
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
        };
    });
    return result;
}
exports.processLedgerTransaction = processLedgerTransaction;
// Export for potential future batch usage
exports.default = { processLedgerTransaction };
//# sourceMappingURL=ledger.js.map