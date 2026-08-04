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
import { ensureFirebaseAuthReady } from '../utils/firebaseAuthHelper';
import {
  GEMS_COLLECTION,
  TRANSACTIONS_COLLECTION,
  ENABLE_PURCHASES,
  ALLOW_SIMULATED_CLIENT_TOPUPS,
  REQUIRE_SERVER_RECEIPT_VALIDATION,
  isUnsafeSimulationMode,
  isClientEconomyMutationAllowed,
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
      await ensureFirebaseAuthReady({ uid: userId });
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
      const msg = String(error?.message || error || '');
      if (msg.includes('jwtToken.split') || msg.includes('split is not a function') || msg.includes('COGNITO_ID_TOKEN') || msg.includes('COGNITO_SESSION_CORRUPTED_RELOGIN')) {
        console.warn('Error getting user gems:', msg);
        return 0;
      }
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

    let unsub = null;
    let cancelled = false;

    (async () => {
      try {
        await ensureFirebaseAuthReady({ uid: userId });
        if (cancelled) return;

        const userGemsRef = doc(db, GEMS_COLLECTION, userId);
        unsub = onSnapshot(userGemsRef, (docSnap) => {
          if (docSnap.exists()) {
            callback(docSnap.data().balance || 0);
          } else {
            callback(0);
          }
        }, (error) => {
          // In dev, auth can legitimately be missing/reseting; avoid red LogBox.
          console.warn('Gems listener warning:', error?.message || String(error));
          callback(0);
        });
      } catch (e) {
        const msg = String(e?.message || e || '');
        if (msg.includes('jwtToken.split') || msg.includes('split is not a function')) {
          console.warn('Gems listener skipped due to corrupted Cognito session; retry after re-login');
        } else {
          console.warn('Gems listener skipped:', msg);
        }
        callback(0);
      }
    })();

    return () => {
      cancelled = true;
      try { unsub && unsub(); } catch {}
    };
  }

  static async addGems(userId, amount, reason = 'grant', metadata = {}) {
    if (!userId || typeof amount !== 'number' || amount <= 0) throw new Error('Invalid addGems parameters');
    // Client-side gem mutations are gated the same way as coins: in production
    // (live-service authoritative) the client must never credit gems directly.
    if (!isClientEconomyMutationAllowed()) {
      console.warn('[ECONOMY][BLOCKED] addGems: client economy mutations are disabled');
      return null;
    }
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
