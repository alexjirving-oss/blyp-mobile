import { calculateScore } from '../../utils/scoreUtils';

const QuickDrawLogic = {
  evaluateDrawing: (drawingData, correctAnswer) => {
    // Logic to evaluate the drawing against the correct answer
    // This could involve image recognition or a simple comparison
    const score = calculateScore(drawingData, correctAnswer);
    return score;
  },

  determineWinner: (playerDrawings, correctAnswer) => {
    let winner = null;
    let highestScore = 0;

    playerDrawings.forEach(player => {
      const score = this.evaluateDrawing(player.drawing, correctAnswer);
      if (score > highestScore) {
        highestScore = score;
        winner = player.id;
      }
    });

    return winner;
  },

  startNewRound: (players) => {
    // Logic to reset the game state for a new round
    const newRoundData = {
      drawings: {},
      currentRound: 1,
      // Additional round-specific data can be added here
    };

    players.forEach(player => {
      newRoundData.drawings[player.id] = null; // Initialize drawings
    });

    return newRoundData;
  },
};

export default QuickDrawLogic;