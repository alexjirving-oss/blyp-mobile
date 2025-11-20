import { calculateScore } from './gameUtils';

// Function to calculate scores for players based on their performance
export const calculatePlayerScore = (correctAnswers, totalQuestions) => {
  if (totalQuestions === 0) return 0;
  return Math.round((correctAnswers / totalQuestions) * 100);
};

// Function to update the leaderboard with new scores
export const updateLeaderboard = (leaderboard, playerId, score) => {
  const updatedLeaderboard = [...leaderboard];
  const playerIndex = updatedLeaderboard.findIndex(player => player.id === playerId);

  if (playerIndex !== -1) {
    updatedLeaderboard[playerIndex].score = score;
  } else {
    updatedLeaderboard.push({ id: playerId, score });
  }

  return updatedLeaderboard.sort((a, b) => b.score - a.score);
};

// Function to get the top players from the leaderboard
export const getTopPlayers = (leaderboard, topN = 5) => {
  return leaderboard.slice(0, topN);
};