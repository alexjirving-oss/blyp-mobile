import { db } from '../config/firebase';
import { onSnapshot, doc, setDoc, updateDoc } from 'firebase/firestore';

const RealtimeGameService = {
  subscribeToGameUpdates: (gameId, callback) => {
    const gameRef = doc(db, 'games', gameId);
    
    const unsubscribe = onSnapshot(gameRef, (doc) => {
      if (doc.exists()) {
        callback(doc.data());
      } else {
        console.error('Game does not exist');
      }
    });

    return unsubscribe;
  },

  updateGameState: async (gameId, newState) => {
    const gameRef = doc(db, 'games', gameId);
    await updateDoc(gameRef, newState);
  },

  createGame: async (gameId, initialState) => {
    const gameRef = doc(db, 'games', gameId);
    await setDoc(gameRef, initialState);
  },
};

export default RealtimeGameService;