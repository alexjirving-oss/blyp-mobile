import { getEconomyWallet, subscribeToEconomyWallet } from './economyApiService';
import { rejectClientEconomyMutation } from './economyAuthority';

class GemService {
  static async getUserGems() {
    const wallet = await getEconomyWallet();
    return wallet.gemAvailable;
  }

  static subscribeToGems(_legacyUserId, callback) {
    return subscribeToEconomyWallet(
      (wallet) => callback(wallet.gemAvailable),
      {
        onError: (error) => {
          console.error('Canonical gem balance refresh failed:', error);
        },
      }
    );
  }

  static async addGems() {
    return rejectClientEconomyMutation(
      'addGems',
      'Gems can be created only by server-authoritative economy operations.'
    );
  }

  static async spendGems() {
    return rejectClientEconomyMutation(
      'spendGems',
      'Generic client-side gem debits are disabled. Use a server-authoritative economy operation.'
    );
  }
}

export default GemService;
