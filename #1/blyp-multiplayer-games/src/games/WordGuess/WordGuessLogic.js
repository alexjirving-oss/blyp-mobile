import { getRandomWord } from '../../utils/randomUtils';

let currentWord = '';
let guessedLetters = [];
let maxAttempts = 6;
let attemptsLeft = maxAttempts;

const WordGuessLogic = {
  startGame: () => {
    currentWord = getRandomWord();
    guessedLetters = [];
    attemptsLeft = maxAttempts;
  },

  checkGuess: (letter) => {
    if (guessedLetters.includes(letter) || attemptsLeft <= 0) {
      return false; // Letter already guessed or game over
    }

    guessedLetters.push(letter);
    if (!currentWord.includes(letter)) {
      attemptsLeft--;
    }
    return true; // Valid guess
  },

  getWordProgress: () => {
    return currentWord.split('').map(letter => 
      guessedLetters.includes(letter) ? letter : '_'
    ).join(' ');
  },

  isGameOver: () => {
    return attemptsLeft <= 0 || WordGuessLogic.isWordGuessed();
  },

  isWordGuessed: () => {
    return currentWord.split('').every(letter => guessedLetters.includes(letter));
  },

  getAttemptsLeft: () => {
    return attemptsLeft;
  },

  getCurrentWord: () => {
    return currentWord;
  },

  getGuessedLetters: () => {
    return guessedLetters;
  }
};

export default WordGuessLogic;