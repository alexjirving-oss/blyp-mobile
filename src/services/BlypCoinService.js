import {
  getEconomyCatalog,
  getEconomyLedger,
  getEconomyWallet,
  sendEconomyGift,
  subscribeToEconomyWallet,
} from './economyApiService';
import { EconomyAuthorityError, rejectClientEconomyMutation } from './economyAuthority';

function ledgerReason(entryType, amount) {
  const value = String(entryType || '').toLowerCase();
  if (value.includes('purchase')) return 'purchase';
  if (value.includes('gift')) return amount >= 0 ? 'gift_received' : 'gift_sent';
  if (value.includes('reward')) return 'daily_reward';
  if (value.includes('promote') || value.includes('boost')) return 'boost';
  return value || 'economy_activity';
}

class BlypCoinService {
  static async getUserBalance() {
    const wallet = await getEconomyWallet();
    return wallet.spendableCoins;
  }

  static subscribeToBalance(_legacyUserId, callback) {
    return subscribeToEconomyWallet(
      (wallet) => callback(wallet.spendableCoins),
      {
        onError: (error) => {
          console.error('Canonical coin balance refresh failed:', error);
        },
      }
    );
  }

  static async addCoins() {
    return rejectClientEconomyMutation(
      'addCoins',
      'Coins can be granted only after server-side purchase verification or an audited administrator operation.'
    );
  }

  static async spendCoins() {
    return rejectClientEconomyMutation(
      'spendCoins',
      'Generic client-side coin debits are disabled. Use a server-authoritative economy operation.'
    );
  }

  static async sendGift(_legacySenderUserId, receiverUserId, giftId, _legacyCost, options = {}) {
    const streamId = String(options.streamId || '').trim();
    if (!streamId) {
      throw new EconomyAuthorityError(
        'sendGift',
        'A canonical stream identifier is required for server-authoritative gifting.'
      );
    }

    return sendEconomyGift({
      streamId,
      receiverUserId,
      giftId,
      quantity: options.quantity || 1,
      idempotencyKey: options.idempotencyKey,
    });
  }

  static async getTransactionHistory(_legacyUserId, limitCount = 50) {
    const { items } = await getEconomyLedger({ limit: limitCount });
    return items.map((item) => {
      const amount = Number(item.amount) || 0;
      return {
        id: item.ledgerId,
        type: amount >= 0 ? 'credit' : 'debit',
        reason: ledgerReason(item.entryType, amount),
        amount: Math.abs(amount),
        timestamp: new Date(item.createdAt),
        currency: item.currency,
        referenceType: item.referenceType,
        referenceId: item.referenceId,
        metadata: item.metadata || {},
      };
    });
  }

  static async claimDailyReward() {
    return rejectClientEconomyMutation(
      'claimDailyReward',
      'Daily rewards require a server-authoritative, abuse-resistant grant endpoint and are not available yet.'
    );
  }

  static async getCatalog() {
    return getEconomyCatalog();
  }

  static getCoinPackages() {
    return [];
  }

  static getGiftTypes() {
    return [];
  }
}

export default BlypCoinService;
