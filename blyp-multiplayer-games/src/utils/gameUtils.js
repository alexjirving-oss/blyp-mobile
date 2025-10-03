import { generateRandomId } from './randomUtils';

// Utility function to create a new game session
export const createGameSession = (gameType, playerIds) => {
  return {
    id: generateRandomId(),
    type: gameType,
    players: playerIds,
    state: 'waiting', // Possible states: waiting, active, finished
    createdAt: new Date(),
  };
};

// Utility function to update game state
export const updateGameState = (gameSession, newState) => {
  return {
    ...gameSession,
    state: newState,
    updatedAt: new Date(),
  };
};

// Utility function to check if a player can join a game
export const canJoinGame = (gameSession, playerId) => {
  return gameSession.state === 'waiting' && !gameSession.players.includes(playerId);
};

// Utility function to get the current player turn
export const getCurrentPlayer = (gameSession) => {
  return gameSession.players[gameSession.turn % gameSession.players.length];
};