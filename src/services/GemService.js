import {
  doc,
  getDoc,
  onSnapshot,
} from 'firebase/firestore';
import { firestore as db } from '../config/firebase';
import { fetchServerWallet, isLiveApiConfigured } from './EconomyApi';

class GemService {
  static async getUserGems(userId) {
    if (isLiveApiConfigured()) {
      try {
        const wallet = await fetchServerWallet();
        return Number(wallet?.gemAvailable || 0) + Number(wallet?.gemPending || 0);
      } catch (error) {
        console.warn('EconomyApi gem read failed; falling back to Firestore read', error?.message || error);
      }
    }

    try {
      const userGemsRef = doc(db, 'gems', userId);
      const gemsDoc = await getDoc(userGemsRef);
      if (gemsDoc.exists()) {
        return gemsDoc.data().balance || 0;
      }
      // Wave 1: never mint starter gems from the client.
      return 0;
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

    const userGemsRef = doc(db, 'gems', userId);

    return onSnapshot(
      userGemsRef,
      (snap) => {
        if (snap.exists()) {
          callback(snap.data().balance || 0);
        } else {
          callback(0);
        }
      },
      (error) => {
        console.error('Error listening to gems:', error);
        callback(0);
      },
    );
  }

  static async addGems(userId, amount, _reason = 'grant', _metadata = {}) {
    if (!userId || typeof amount !== 'number' || amount <= 0) throw new Error('Invalid addGems parameters');
    throw new Error('CLIENT_MINT_DISABLED');
  }

  static async spendGems(_userId, _amount, _reason = 'spend', _metadata = {}) {
    throw new Error('CLIENT_SPEND_DISABLED');
  }
}

export default GemService;
