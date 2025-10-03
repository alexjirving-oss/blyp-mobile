import { db } from '../config/firebase';
import { collection, addDoc, updateDoc, doc, getDoc, query, where, onSnapshot } from 'firebase/firestore';

export const createGameSession = async (gameData) => {
  try {
    const docRef = await addDoc(collection(db, 'games'), gameData);
    return docRef.id;
  } catch (error) {
    console.error('Error creating game session:', error);
    throw new Error('Could not create game session');
  }
};

export const joinGameSession = async (gameId, playerData) => {
  try {
    const gameRef = doc(db, 'games', gameId);
    await updateDoc(gameRef, {
      players: [...gameData.players, playerData],
    });
  } catch (error) {
    console.error('Error joining game session:', error);
    throw new Error('Could not join game session');
  }
};

export const getGameSession = async (gameId) => {
  try {
    const gameRef = doc(db, 'games', gameId);
    const gameSnap = await getDoc(gameRef);
    if (gameSnap.exists()) {
      return gameSnap.data();
    } else {
      throw new Error('Game session not found');
    }
  } catch (error) {
    console.error('Error fetching game session:', error);
    throw new Error('Could not fetch game session');
  }
};

export const subscribeToGameSession = (gameId, callback) => {
  const gameRef = doc(db, 'games', gameId);
  return onSnapshot(gameRef, (doc) => {
    if (doc.exists()) {
      callback(doc.data());
    } else {
      console.error('Game session not found');
    }
  });
};