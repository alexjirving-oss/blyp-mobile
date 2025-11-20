import { Player } from './Player'; // Assuming a Player type is defined elsewhere

// Define types for game states
export interface GameState {
  id: string;
  players: Player[];
  currentTurn: string; // Player ID of the current turn
  isGameOver: boolean;
  winner?: string; // Player ID of the winner, if applicable
}

// Define types for player data
export interface PlayerData {
  id: string;
  name: string;
  avatarUrl: string;
  score: number;
}

// Define types for game configurations
export interface GameConfig {
  maxPlayers: number;
  timeLimit?: number; // Optional time limit for the game
}

// Exporting constants for game types
export const GameTypes = {
  TIC_TAC_TOE: 'TIC_TAC_TOE',
  WORD_GUESS: 'WORD_GUESS',
  QUICK_DRAW: 'QUICK_DRAW',
};