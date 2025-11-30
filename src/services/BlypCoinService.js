import {
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  increment,
  serverTimestamp,
  collection,
  addDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  runTransaction
} from 'firebase/firestore';
import { firestore as db } from '../config/firebase';
// Centralized economy model & flags
import {
  WALLETS_COLLECTION,
  TRANSACTIONS_COLLECTION,
  GIFTS_COLLECTION,
  ENABLE_PURCHASES,
  ALLOW_SIMULATED_CLIENT_TOPUPS,
  REQUIRE_SERVER_RECEIPT_VALIDATION,
  isUnsafeSimulationMode,
  shouldUseServerValidation
} from '../config/economyModel';
import { verifyPlayStorePurchase } from './BillingVerificationService';
import { appendLedgerEntryViaTransaction } from './LedgerService';
import analytics from './EnterpriseAnalyticsService';

// Stage 3.1 verification bridge (still gated by flags)
// TODO(stage3-economy-hardening): Wire real productId & purchaseToken from platform billing integration.
async function verifyPurchaseWithServer(purchasePayload) {
  // Simulation mode: always succeed explicitly
  if (isUnsafeSimulationMode()) {
    return { ok: true, reason: 'simulation-mode' };
  }
  // Server validation not required yet → behave as previous (no-op success)
  if (!shouldUseServerValidation()) {
    return { ok: true, reason: 'not-implemented' };
  }
  // Attempt server verification (Play Store path placeholder)
  const { userId, amount, metadata } = purchasePayload || {};
  const productId = metadata?.packageId || metadata?.productId; // heuristic until real mapping
  const purchaseToken = metadata?.purchaseToken; // likely undefined until integrated
  const result = await verifyPlayStorePurchase({ productId, purchaseToken, userId });
  if (!result.ok) {
    analytics?.addEvent?.({
      type: 'economy_purchase_verification_failed',
      userId,
      asset: 'coin',
      productId,
      amount,
      reason: result.reason,
      provider: result.provider,
      timestamp: Date.now()
    });
  }
  return { ok: result.ok, reason: result.reason };
}

class BlypCoinService {
  // Get user's current Blypcoin balance
  static async getUserBalance(userId) {
    try {
      const userWalletRef = doc(db, WALLETS_COLLECTION, userId);
      const walletDoc = await getDoc(userWalletRef);
      
      if (walletDoc.exists()) {
        return walletDoc.data().balance || 0;
      } else {
        // Create wallet if it doesn't exist
        await setDoc(userWalletRef, {
          balance: 0,
          totalEarned: 0,
          totalSpent: 0,
          createdAt: serverTimestamp(),
          lastUpdated: serverTimestamp()
        });
        return 0;
      }
    } catch (error) {
      console.error('Error getting user balance:', error);
      throw error;
    }
  }

  // Subscribe to real-time balance updates
  static subscribeToBalance(userId, callback) {
    const userWalletRef = doc(db, WALLETS_COLLECTION, userId);
    
    return onSnapshot(userWalletRef, (doc) => {
      if (doc.exists()) {
        callback(doc.data().balance || 0);
      } else {
        callback(0);
      }
    }, (error) => {
      console.error('Error listening to balance:', error);
      callback(0);
    });
  }

  // Add Blypcoins to user account (earning/purchasing)
  static async addCoins(userId, amount, reason = 'purchase', metadata = {}) {
    // Guard purchases globally
    if (reason === 'purchase' && !ENABLE_PURCHASES) {
      console.warn('[ECONOMY] Purchases disabled via ENABLE_PURCHASES flag');
      return null; // safe no-op
    }
    if (reason === 'purchase' && !ALLOW_SIMULATED_CLIENT_TOPUPS && !REQUIRE_SERVER_RECEIPT_VALIDATION) {
      console.warn('[ECONOMY] Simulated topups disabled without server validation');
      return null; // safe no-op
    }
    if (reason === 'purchase') {
      const verify = await verifyPurchaseWithServer({ userId, amount, metadata });
      if (!verify.ok) {
        console.warn('[ECONOMY] Purchase verification failed');
        return null;
      }
    }
    try {
      const result = await runTransaction(db, async (transaction) => {
        const userWalletRef = doc(db, WALLETS_COLLECTION, userId);
        const walletDoc = await transaction.get(userWalletRef);
        
        let currentBalance = 0;
        let totalEarned = 0;
        
        if (walletDoc.exists()) {
          const data = walletDoc.data();
          currentBalance = data.balance || 0;
          totalEarned = data.totalEarned || 0;
        }
        
        const newBalance = currentBalance + amount;
        const newTotalEarned = totalEarned + amount;
        
        // Update wallet
        transaction.set(userWalletRef, {
          balance: newBalance,
          totalEarned: newTotalEarned,
          totalSpent: walletDoc.exists() ? (walletDoc.data().totalSpent || 0) : 0,
          lastUpdated: serverTimestamp(),
          createdAt: walletDoc.exists() ? walletDoc.data().createdAt : serverTimestamp()
        });
        
        // Record transaction (ledger routed)
        appendLedgerEntryViaTransaction(transaction, {
          userId,
          ledgerType: reason === 'purchase' ? 'coin_purchase' : (reason === 'daily_reward' ? 'daily_reward' : 'adjustment'),
          amount,
          currency: 'COIN',
          txType: 'credit',
          balance: newBalance,
          reason,
          metadata,
          source: reason === 'purchase' ? 'store' : 'admin'
        });
        
        return newBalance;
      });
      
      console.log('💰 Added', amount, 'Blypcoins to user:', userId, 'New balance:', result);
      return result;
    } catch (error) {
      console.error('Error adding coins:', error);
      throw error;
    }
  }

  // Spend Blypcoins (for gifts, features, etc.)
  static async spendCoins(userId, amount, reason = 'purchase', metadata = {}) {
    try {
      const result = await runTransaction(db, async (transaction) => {
        const userWalletRef = doc(db, WALLETS_COLLECTION, userId);
        const walletDoc = await transaction.get(userWalletRef);
        
        if (!walletDoc.exists()) {
          throw new Error('Wallet not found');
        }
        
        const data = walletDoc.data();
        const currentBalance = data.balance || 0;
        
        if (currentBalance < amount) {
          throw new Error('Insufficient balance');
        }
        
        const newBalance = currentBalance - amount;
        const totalSpent = (data.totalSpent || 0) + amount;
        
        // Update wallet
        transaction.update(userWalletRef, {
          balance: newBalance,
          totalSpent,
          lastUpdated: serverTimestamp()
        });
        
        // Record transaction (ledger routed)
        appendLedgerEntryViaTransaction(transaction, {
          userId,
          ledgerType: reason === 'gift_send' ? 'gift_send' : 'adjustment',
          amount,
          currency: 'COIN',
          txType: 'debit',
          balance: newBalance,
          reason,
          metadata,
          source: 'store'
        });
        
        return newBalance;
      });
      
      console.log('💸 Spent', amount, 'Blypcoins for user:', userId, 'New balance:', result);
      return result;
    } catch (error) {
      console.error('Error spending coins:', error);
      throw error;
    }
  }

  // Send gift to another user
  static async sendGift(fromUserId, toUserId, giftType, cost) {
    try {
      const result = await runTransaction(db, async (transaction) => {
        // ALL READS FIRST - Firestore transaction requirement
        const senderWalletRef = doc(db, WALLETS_COLLECTION, fromUserId);
        const receiverWalletRef = doc(db, WALLETS_COLLECTION, toUserId);
        
        // Read both wallets first
        const senderWallet = await transaction.get(senderWalletRef);
        const receiverWallet = await transaction.get(receiverWalletRef);
        
        // Check sender's balance
        if (!senderWallet.exists() || (senderWallet.data().balance || 0) < cost) {
          throw new Error('Insufficient balance');
        }
        
        // NOW ALL WRITES - after all reads are complete
        const receiverAmount = Math.floor(cost * 0.7); // 70% to receiver, 30% platform fee
        
        // Update sender wallet
        const senderBalance = senderWallet.data().balance - cost;
        transaction.update(senderWalletRef, {
          balance: senderBalance,
          totalSpent: (senderWallet.data().totalSpent || 0) + cost,
          lastUpdated: serverTimestamp()
        });
        
        // Update or create receiver wallet
        
        if (receiverWallet.exists()) {
          transaction.update(receiverWalletRef, {
            balance: (receiverWallet.data().balance || 0) + receiverAmount,
            totalEarned: (receiverWallet.data().totalEarned || 0) + receiverAmount,
            lastUpdated: serverTimestamp()
          });
        } else {
          transaction.set(receiverWalletRef, {
            balance: receiverAmount,
            totalEarned: receiverAmount,
            totalSpent: 0,
            createdAt: serverTimestamp(),
            lastUpdated: serverTimestamp()
          });
        }
        
        // Record gift transaction
        const giftRef = doc(collection(db, GIFTS_COLLECTION));
        transaction.set(giftRef, {
          fromUserId,
          toUserId,
          giftType,
          cost,
          receiverAmount,
          timestamp: serverTimestamp(),
          status: 'completed'
        });
        
        // Record transactions (ledger routed)
        appendLedgerEntryViaTransaction(transaction, {
          userId: fromUserId,
          ledgerType: 'gift_send',
          amount: cost,
          currency: 'COIN',
          txType: 'debit',
          balance: senderBalance,
          reason: 'gift_sent',
          relatedUserId: toUserId,
          metadata: { giftType, recipient: toUserId },
          source: 'live'
        });
        appendLedgerEntryViaTransaction(transaction, {
          userId: toUserId,
          ledgerType: 'gift_receive',
          amount: receiverAmount,
          currency: 'COIN',
          txType: 'credit',
          balance: (receiverWallet.exists() ? receiverWallet.data().balance : 0) + receiverAmount,
          reason: 'gift_received',
          relatedUserId: fromUserId,
          metadata: { giftType, sender: fromUserId },
          source: 'live'
        });
        
        return { senderBalance, receiverAmount };
      });
      
      console.log('🎁 Gift sent:', giftType, 'from', fromUserId, 'to', toUserId, 'cost:', cost);
      return result;
    } catch (error) {
      console.error('Error sending gift:', error);
      throw error;
    }
  }

  // Get user's transaction history
  static async getTransactionHistory(userId, limitCount = 50) {
    try {
      const q = query(
        collection(db, TRANSACTIONS_COLLECTION),
        where('userId', '==', userId),
        orderBy('timestamp', 'desc'),
        limit(limitCount)
      );
      
      const querySnapshot = await getDocs(q);
      const transactions = [];
      
      querySnapshot.forEach((doc) => {
        transactions.push({
          id: doc.id,
          ...doc.data(),
          timestamp: doc.data().timestamp?.toDate() || new Date()
        });
      });
      
      return transactions;
    } catch (error) {
      console.error('Error getting transaction history:', error);
      throw error;
    }
  }

  // Daily check-in reward
  static async claimDailyReward(userId) {
    try {
      const userRef = doc(db, 'users', userId); // User collection remains separate.
      const userDoc = await getDoc(userRef);
      
      if (!userDoc.exists()) {
        throw new Error('User not found');
      }
      
      const userData = userDoc.data();
      const lastCheckIn = userData.lastCheckIn?.toDate();
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      // Check if already claimed today
      if (lastCheckIn && lastCheckIn >= today) {
        throw new Error('Daily reward already claimed');
      }
      
      // Calculate streak
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      
      let streak = userData.checkInStreak || 0;
      if (lastCheckIn && lastCheckIn >= yesterday) {
        streak += 1;
      } else {
        streak = 1; // Reset streak
      }
      
      // Calculate reward based on streak
      const baseReward = 10;
      const streakBonus = Math.min(streak * 2, 50); // Max 50 bonus
      const totalReward = baseReward + streakBonus;
      
      // Update user check-in data
      await updateDoc(userRef, {
        lastCheckIn: serverTimestamp(),
        checkInStreak: streak
      });
      
      // Add coins
      await this.addCoins(userId, totalReward, 'daily_reward', { streak, baseReward, streakBonus }); // TODO(stage2-economy-safety): Consider moving daily rewards to server-side authority.
      
      return { reward: totalReward, streak };
    } catch (error) {
      console.error('Error claiming daily reward:', error);
      throw error;
    }
  }

  // Coin packages for purchase
  static getCoinPackages() {
    return [
      {
        id: 'small',
        coins: 100,
        price: 0.99,
        bonus: 0,
        popular: false,
        icon: '💰'
      },
      {
        id: 'medium',
        coins: 500,
        price: 4.99,
        bonus: 50,
        popular: false,
        icon: '💎'
      },
      {
        id: 'large',
        coins: 1000,
        price: 9.99,
        bonus: 150,
        popular: true,
        icon: '💍'
      },
      {
        id: 'mega',
        coins: 2500,
        price: 19.99,
        bonus: 500,
        popular: false,
        icon: '👑'
      },
      {
        id: 'ultimate',
        coins: 5000,
        price: 39.99,
        bonus: 1500,
        popular: false,
        icon: '🔮'
      }
    ];
  }

  // Gift types and costs
  static getGiftTypes() {
    return [
      { id: 'heart', name: 'Heart', cost: 1, emoji: '❤️', rarity: 'common' },
      { id: 'thumbsup', name: 'Thumbs Up', cost: 2, emoji: '👍', rarity: 'common' },
      { id: 'clap', name: 'Clap', cost: 5, emoji: '👏', rarity: 'common' },
      { id: 'fire', name: 'Fire', cost: 10, emoji: '🔥', rarity: 'rare' },
      { id: 'star', name: 'Star', cost: 15, emoji: '⭐', rarity: 'rare' },
      { id: 'diamond', name: 'Diamond', cost: 25, emoji: '💎', rarity: 'epic' },
      { id: 'crown', name: 'Crown', cost: 50, emoji: '👑', rarity: 'legendary' },
      { id: 'rocket', name: 'Rocket', cost: 100, emoji: '🚀', rarity: 'legendary' }
    ];
  }
}

// TODO(stage2-economy-safety): Enforce server-side validation for all purchase reasons.
// TODO(stage2-economy-safety): Introduce withdrawal flow guarded by ENABLE_WITHDRAWALS.
// TODO(stage2-economy-safety): Add velocity / anti-fraud checks for sendGift operations.

export default BlypCoinService;