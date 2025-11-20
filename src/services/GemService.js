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

class GemService {
  static async getUserGems(userId) {
    try {
      const userGemsRef = doc(db, 'gems', userId);
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

    const userGemsRef = doc(db, 'gems', userId);
    
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
      const txRef = doc(collection(db, 'transactions'));
      transaction.set(txRef, {
        userId,
        asset: 'gem',
        type: 'credit',
        amount,
        balance: newBalance,
        reason,
        timestamp: serverTimestamp(),
        metadata
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
      const txRef = doc(collection(db, 'transactions'));
      transaction.set(txRef, {
        userId,
        asset: 'gem',
        type: 'debit',
        amount,
        balance: newBalance,
        reason,
        timestamp: serverTimestamp(),
        metadata
      });
      return newBalance;
    });
    return result;
  }
}

export default GemService;
