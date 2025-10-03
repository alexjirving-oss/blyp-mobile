import { 
  doc, 
  getDoc,
  setDoc, 
  updateDoc, 
  increment, 
  serverTimestamp,
  onSnapshot,
  runTransaction
} from 'firebase/firestore';
import { db } from '../config/firebase';

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
}

export default GemService;
