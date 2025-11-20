import { db } from '../config/firebase';
import { collection, addDoc, query, where, onSnapshot } from 'firebase/firestore';

const matchmakingQueue = [];

const addToQueue = (playerId) => {
  matchmakingQueue.push(playerId);
  checkForMatch();
};

const removeFromQueue = (playerId) => {
  const index = matchmakingQueue.indexOf(playerId);
  if (index > -1) {
    matchmakingQueue.splice(index, 1);
  }
};

const checkForMatch = () => {
  if (matchmakingQueue.length >= 2) {
    const player1 = matchmakingQueue.shift();
    const player2 = matchmakingQueue.shift();
    createGameSession(player1, player2);
  }
};

const createGameSession = async (player1, player2) => {
  try {
    const gameSessionRef = await addDoc(collection(db, 'gameSessions'), {
      players: [player1, player2],
      status: 'waiting',
      createdAt: new Date(),
    });
    console.log('Game session created with ID:', gameSessionRef.id);
  } catch (error) {
    console.error('Error creating game session:', error);
  }
};

const subscribeToMatchmaking = (callback) => {
  const q = query(collection(db, 'gameSessions'), where('status', 'waiting'));
  return onSnapshot(q, (snapshot) => {
    const sessions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    callback(sessions);
  });
};

export { addToQueue, removeFromQueue, subscribeToMatchmaking };