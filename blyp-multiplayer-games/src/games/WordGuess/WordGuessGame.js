import React, { useState } from 'react';

class WordGuessGame {
  constructor(word) {
    this.word = word.toLowerCase();
    this.guesses = [];
    this.maxAttempts = 6;
    this.attempts = 0;
    this.isGameOver = false;
    this.isWinner = false;
  }

  makeGuess(letter) {
    if (this.isGameOver) {
      return;
    }

    letter = letter.toLowerCase();
    if (this.guesses.includes(letter)) {
      return; // Letter has already been guessed
    }

    this.guesses.push(letter);
    if (!this.word.includes(letter)) {
      this.attempts++;
    }

    this.checkGameOver();
  }

  checkGameOver() {
    if (this.attempts >= this.maxAttempts) {
      this.isGameOver = true;
    } else if (this.isWordGuessed()) {
      this.isGameOver = true;
      this.isWinner = true;
    }
  }

  isWordGuessed() {
    return this.word.split('').every(letter => this.guesses.includes(letter));
  }

  getWordProgress() {
    return this.word.split('').map(letter => (this.guesses.includes(letter) ? letter : '_')).join(' ');
  }

  getRemainingAttempts() {
    return this.maxAttempts - this.attempts;
  }

  resetGame(newWord) {
    this.word = newWord.toLowerCase();
    this.guesses = [];
    this.attempts = 0;
    this.isGameOver = false;
    this.isWinner = false;
  }
}

export default WordGuessGame;