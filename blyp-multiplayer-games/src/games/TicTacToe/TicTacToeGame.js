import { EventEmitter } from 'events';
import TicTacToeLogic from './TicTacToeLogic';

class TicTacToeGame extends EventEmitter {
  constructor(player1, player2) {
    super();
    this.players = [player1, player2];
    this.currentPlayerIndex = 0;
    this.board = Array(9).fill(null);
    this.winner = null;
    this.isGameOver = false;
  }

  getCurrentPlayer() {
    return this.players[this.currentPlayerIndex];
  }

  makeMove(position) {
    if (this.isGameOver || this.board[position] !== null) {
      return false; // Invalid move
    }

    this.board[position] = this.getCurrentPlayer();
    this.emit('moveMade', position, this.getCurrentPlayer());

    if (TicTacToeLogic.checkWin(this.board, this.getCurrentPlayer())) {
      this.winner = this.getCurrentPlayer();
      this.isGameOver = true;
      this.emit('gameOver', this.winner);
    } else if (this.board.every(cell => cell !== null)) {
      this.isGameOver = true; // Draw
      this.emit('gameOver', null);
    } else {
      this.currentPlayerIndex = (this.currentPlayerIndex + 1) % 2; // Switch player
    }

    return true; // Move was successful
  }

  resetGame() {
    this.board = Array(9).fill(null);
    this.currentPlayerIndex = 0;
    this.winner = null;
    this.isGameOver = false;
    this.emit('gameReset');
  }

  getBoard() {
    return this.board;
  }

  getWinner() {
    return this.winner;
  }

  isGameFinished() {
    return this.isGameOver;
  }
}

export default TicTacToeGame;