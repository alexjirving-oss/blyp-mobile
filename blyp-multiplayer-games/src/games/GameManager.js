import { GameTypes } from './GameTypes';

class GameManager {
  constructor() {
    this.games = {};
    this.activeGames = [];
  }

  startGame(gameType, players) {
    const gameId = this.generateGameId();
    let game;

    switch (gameType) {
      case GameTypes.TIC_TAC_TOE:
        game = new TicTacToeGame(gameId, players);
        break;
      case GameTypes.WORD_GUESS:
        game = new WordGuessGame(gameId, players);
        break;
      case GameTypes.QUICK_DRAW:
        game = new QuickDrawGame(gameId, players);
        break;
      default:
        throw new Error('Invalid game type');
    }

    this.games[gameId] = game;
    this.activeGames.push(gameId);
    return gameId;
  }

  endGame(gameId) {
    if (this.games[gameId]) {
      delete this.games[gameId];
      this.activeGames = this.activeGames.filter(id => id !== gameId);
    } else {
      throw new Error('Game not found');
    }
  }

  getGame(gameId) {
    return this.games[gameId] || null;
  }

  generateGameId() {
    return `game_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  }

  getActiveGames() {
    return this.activeGames.map(gameId => this.games[gameId]);
  }
}

export default GameManager;