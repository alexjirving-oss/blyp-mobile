import {
  doc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
} from 'firebase/firestore';
import { firestore as db } from '../config/firebase';
import {
  fetchServerWallet,
  isLiveApiConfigured,
  sendServerGift,
} from './EconomyApi';

const COGNITO_SUB_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class BlypCoinService {
  // Prefer server wallet (Cognito). Firestore is read-only fallback and never creates/credits.
  static async getUserBalance(userId) {
    if (isLiveApiConfigured()) {
      try {
        const wallet = await fetchServerWallet();
        return Number(wallet?.coinBalance || 0) + Number(wallet?.bonusCoinBalance || 0);
      } catch (error) {
        // Fall through to read-only Firestore for display when API is briefly unavailable.
        console.warn('EconomyApi wallet read failed; falling back to Firestore read', error?.message || error);
      }
    }

    try {
      const userWalletRef = doc(db, 'wallets', userId);
      const walletDoc = await getDoc(userWalletRef);
      if (walletDoc.exists()) {
        return walletDoc.data().balance || 0;
      }
      return 0;
    } catch (error) {
      console.error('Error getting user balance:', error);
      throw error;
    }
  }

  static subscribeToBalance(userId, callback) {
    const userWalletRef = doc(db, 'wallets', userId);

    return onSnapshot(
      userWalletRef,
      (snap) => {
        if (snap.exists()) {
          callback(snap.data().balance || 0);
        } else {
          callback(0);
        }
      },
      (error) => {
        console.error('Error listening to balance:', error);
        callback(0);
      },
    );
  }

  static async addCoins(_userId, _amount, _reason = 'purchase', _metadata = {}) {
    throw new Error('CLIENT_MINT_DISABLED');
  }

  static async spendCoins(_userId, _amount, _reason = 'purchase', _metadata = {}) {
    // Wave 1: coin spends must go through authenticated server economy endpoints.
    throw new Error('CLIENT_SPEND_DISABLED');
  }

  /**
   * Send a gift through the live-service economy API.
   * Options (preferred): { streamId, receiverUserId, giftId, quantity, idempotencyKey }
   * Legacy positional args are rejected because they targeted Firestore mint/spend.
   */
  static async sendGift(fromUserIdOrOptions, toUserId, giftType, cost) {
    if (fromUserIdOrOptions && typeof fromUserIdOrOptions === 'object') {
      const {
        streamId,
        receiverUserId,
        giftId,
        quantity = 1,
        idempotencyKey,
      } = fromUserIdOrOptions;

      if (!isLiveApiConfigured()) {
        throw new Error('LIVE_API_NOT_CONFIGURED');
      }
      if (!streamId || !giftId) {
        throw new Error('GIFT_REQUIRES_STREAM_AND_CATALOG_ID');
      }
      if (!COGNITO_SUB_REGEX.test(String(receiverUserId || ''))) {
        throw new Error('GIFT_RECEIVER_REQUIRES_COGNITO_SUB');
      }

      return sendServerGift({
        streamId,
        receiverUserId,
        giftId,
        quantity,
        idempotencyKey,
      });
    }

    // Legacy Firestore gift path (Firebase uid + local gift costs) is permanently disabled.
    void fromUserIdOrOptions;
    void toUserId;
    void giftType;
    void cost;
    throw new Error('CLIENT_GIFT_DISABLED');
  }

  static async getTransactionHistory(userId, limitCount = 50) {
    try {
      const q = query(
        collection(db, 'transactions'),
        where('userId', '==', userId),
        orderBy('timestamp', 'desc'),
        limit(limitCount),
      );

      const querySnapshot = await getDocs(q);
      const transactions = [];

      querySnapshot.forEach((snap) => {
        transactions.push({
          id: snap.id,
          ...snap.data(),
          timestamp: snap.data().timestamp?.toDate() || new Date(),
        });
      });

      return transactions;
    } catch (error) {
      console.error('Error getting transaction history:', error);
      throw error;
    }
  }

  static async claimDailyReward(_userId) {
    throw new Error('CLIENT_MINT_DISABLED');
  }

  static getCoinPackages() {
    return [
      { id: 'small', coins: 100, price: 0.99, bonus: 0, popular: false, icon: '💰' },
      { id: 'medium', coins: 500, price: 4.99, bonus: 50, popular: false, icon: '💎' },
      { id: 'large', coins: 1000, price: 9.99, bonus: 150, popular: true, icon: '💍' },
      { id: 'mega', coins: 2500, price: 19.99, bonus: 500, popular: false, icon: '👑' },
      { id: 'ultimate', coins: 5000, price: 39.99, bonus: 1500, popular: false, icon: '🔮' },
    ];
  }

  static getGiftTypes() {
    return [
      { id: 'heart', name: 'Heart', cost: 1, emoji: '❤️', rarity: 'common' },
      { id: 'thumbsup', name: 'Thumbs Up', cost: 2, emoji: '👍', rarity: 'common' },
      { id: 'clap', name: 'Clap', cost: 5, emoji: '👏', rarity: 'common' },
      { id: 'fire', name: 'Fire', cost: 10, emoji: '🔥', rarity: 'rare' },
      { id: 'star', name: 'Star', cost: 15, emoji: '⭐', rarity: 'rare' },
      { id: 'diamond', name: 'Diamond', cost: 25, emoji: '💎', rarity: 'epic' },
      { id: 'crown', name: 'Crown', cost: 50, emoji: '👑', rarity: 'legendary' },
      { id: 'rocket', name: 'Rocket', cost: 100, emoji: '🚀', rarity: 'legendary' },
    ];
  }
}

export default BlypCoinService;
