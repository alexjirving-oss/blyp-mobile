// Shared game-related types for the Blyp multiplayer modules

export interface Player {
  id: string;
  name: string;
  avatarUrl?: string;
  score?: number;
}

export interface GameState {
  id: string;
  players: Player[];
  currentTurn: string; // Player ID of the current turn
  isGameOver: boolean;
  winner?: string; // Player ID of the winner, if applicable
}

export interface PlayerData {
  id: string;
  name: string;
  avatarUrl: string;
  score: number;
}

export interface GameConfig {
  maxPlayers: number;
  timeLimit?: number; // Optional time limit for the game
}

export const GameTypes = {
  TIC_TAC_TOE: 'TIC_TAC_TOE',
  WORD_GUESS: 'WORD_GUESS',
  QUICK_DRAW: 'QUICK_DRAW',
} as const;

export type GameType = typeof GameTypes[keyof typeof GameTypes];
