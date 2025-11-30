import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  onSnapshot,
  runTransaction,
  collection
} from 'firebase/firestore';
import { firestore as db } from '../config/firebase';
import {
  GEMS_COLLECTION,
  TRANSACTIONS_COLLECTION,
  ENABLE_PURCHASES,
  ALLOW_SIMULATED_CLIENT_TOPUPS,
  REQUIRE_SERVER_RECEIPT_VALIDATION,
  isUnsafeSimulationMode,
  shouldUseServerValidation
} from '../config/economyModel';
import { verifyPlayStorePurchase } from './BillingVerificationService';
import analytics from './EnterpriseAnalyticsService';
import { appendLedgerEntryViaTransaction } from './LedgerService';

// Stage 3.1: Gem purchase verification bridge
// TODO(stage3-economy-hardening): Wire real productId & purchaseToken for gems.
async function verifyGemPurchase(purchasePayload) {
  if (isUnsafeSimulationMode()) return { ok: true, reason: 'simulation-mode' };
  if (!shouldUseServerValidation()) return { ok: true, reason: 'not-implemented' };
  const { userId, amount, metadata } = purchasePayload || {};
  const productId = metadata?.packageId || metadata?.productId;
  const purchaseToken = metadata?.purchaseToken;
  const result = await verifyPlayStorePurchase({ productId, purchaseToken, userId });
  if (!result.ok) {
    analytics?.addEvent?.({
      type: 'economy_purchase_verification_failed',
      userId,
      asset: 'gem',
      productId,
      amount,
      reason: result.reason,
      provider: result.provider,
      timestamp: Date.now()
    });
  }
  return { ok: result.ok, reason: result.reason };
}

class GemService {
  static async getUserGems(userId) {
    try {
      const userGemsRef = doc(db, GEMS_COLLECTION, userId);
      const gemsDoc = await getDoc(userGemsRef);
      
      if (gemsDoc.exists()) {
        return gemsDoc.data().balance || 0;
      } else {
        const starterGems = 47;
        await setDoc(userGemsRef, {
          balance: starterGems,
          totalEarned: starterGems,
          totalSpent: 0,
          createdAt: serverTimestamp(),
          lastUpdated: serverTimestamp()
        });
        return starterGems;
      }
    } catch (error) {
      console.error('Error getting user gems:', error);
      throw error;
    }
  }

  static subscribeToGems(userId, callback) {
    if (!userId) {
      console.error('No userId provided to subscribeToGems');
      callback(0);
      return () => {};
    }

    const userGemsRef = doc(db, GEMS_COLLECTION, userId);
    
    return onSnapshot(userGemsRef, (doc) => {
      if (doc.exists()) {
        callback(doc.data().balance || 0);
      } else {
        callback(0);
      }
    }, (error) => {
      console.error('Error listening to gems:', error);
      callback(0);
    });
  }

  static async addGems(userId, amount, reason = 'grant', metadata = {}) {
    if (!userId || typeof amount !== 'number' || amount <= 0) throw new Error('Invalid addGems parameters');
    if (reason === 'purchase' && !ENABLE_PURCHASES) {
      console.warn('[ECONOMY] Gem purchases disabled via ENABLE_PURCHASES flag');
      return null;
    }
    if (reason === 'purchase' && !ALLOW_SIMULATED_CLIENT_TOPUPS && !REQUIRE_SERVER_RECEIPT_VALIDATION) {
      console.warn('[ECONOMY] Simulated gem topups disabled without server validation');
      return null;
    }
    if (reason === 'purchase') {
      const verify = await verifyGemPurchase({ userId, amount, metadata });
      if (!verify.ok) {
        console.warn('[ECONOMY] Gem purchase verification failed');
        return null;
      }
    }
    const result = await runTransaction(db, async (transaction) => {
      const gemsRef = doc(db, 'gems', userId);
      const snap = await transaction.get(gemsRef);
      let balance = 0;
      let totalEarned = 0;
      let totalSpent = 0;
      let createdAt = serverTimestamp();
      if (snap.exists()) {
        const data = snap.data() || {};
        balance = data.balance || 0;
        totalEarned = data.totalEarned || 0;
        totalSpent = data.totalSpent || 0;
        createdAt = data.createdAt || createdAt;
      }
      const newBalance = balance + amount;
      transaction.set(gemsRef, {
        balance: newBalance,
        totalEarned: totalEarned + amount,
        totalSpent,
        createdAt,
        lastUpdated: serverTimestamp()
      });
      appendLedgerEntryViaTransaction(transaction, {
        userId,
        ledgerType: reason === 'purchase' ? 'gem_purchase' : 'adjustment',
        amount,
        currency: 'GEM',
        txType: 'credit',
        balance: newBalance,
        reason,
        metadata,
        source: reason === 'purchase' ? 'store' : 'admin'
      });
      return newBalance;
    });
    return result;
  }

  static async spendGems(userId, amount, reason = 'spend', metadata = {}) {
    if (!userId || typeof amount !== 'number' || amount <= 0) throw new Error('Invalid spendGems parameters');
    const result = await runTransaction(db, async (transaction) => {
      const gemsRef = doc(db, 'gems', userId);
      const snap = await transaction.get(gemsRef);
      if (!snap.exists()) throw new Error('Gem wallet not found');
      const data = snap.data() || {};
      const balance = data.balance || 0;
      if (balance < amount) throw new Error('Insufficient gems');
      const newBalance = balance - amount;
      transaction.update(gemsRef, {
        balance: newBalance,
        totalSpent: (data.totalSpent || 0) + amount,
        lastUpdated: serverTimestamp()
      });
      appendLedgerEntryViaTransaction(transaction, {
        userId,
        ledgerType: reason === 'gift_send' ? 'gift_send' : 'adjustment',
        amount,
        currency: 'GEM',
        txType: 'debit',
        balance: newBalance,
        reason,
        metadata,
        source: 'store'
      });
      return newBalance;
    });
    return result;
  }
}

// TODO(stage2-economy-safety): Add anti-fraud velocity limits to addGems/spendGems operations.
// TODO(stage2-economy-safety): Migrate gem ledger to unified transaction derivation.

export default GemService;
