import { checkWin, isValidMove } from './TicTacToeLogic';

class TicTacToeGame {
  constructor() {
    this.board = Array(9).fill(null);
    this.currentPlayer = 'X';
    this.winner = null;
  }

  makeMove(index) {
    if (this.winner || !isValidMove(this.board, index)) {
      return false;
    }

    this.board[index] = this.currentPlayer;
    this.winner = checkWin(this.board);

    this.currentPlayer = this.currentPlayer === 'X' ? 'O' : 'X';
    return true;
  }

  resetGame() {
    this.board = Array(9).fill(null);
    this.currentPlayer = 'X';
    this.winner = null;
  }

  getCurrentPlayer() {
    return this.currentPlayer;
  }

  getWinner() {
    return this.winner;
  }

  getBoard() {
    return this.board;
  }
}

export default TicTacToeGame;