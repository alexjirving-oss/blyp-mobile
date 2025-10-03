import { randomInt } from 'crypto';

// Generates a random integer between min (inclusive) and max (exclusive)
export const getRandomInt = (min, max) => {
  return randomInt(min, max);
};

// Selects a random item from an array
export const getRandomItem = (array) => {
  if (array.length === 0) return null;
  const randomIndex = getRandomInt(0, array.length);
  return array[randomIndex];
};

// Shuffles an array using the Fisher-Yates algorithm
export const shuffleArray = (array) => {
  for (let i = array.length - 1; i > 0; i--) {
    const j = getRandomInt(0, i + 1);
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
};