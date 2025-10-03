export const calculateScore = (playerActions) => {
    let score = 0;
    playerActions.forEach(action => {
        switch (action.type) {
            case 'win':
                score += 10;
                break;
            case 'lose':
                score -= 5;
                break;
            case 'draw':
                score += 3;
                break;
            default:
                score += 0;
                break;
        }
    });
    return score;
};

export const checkWinCondition = (gameState) => {
    // Implement win condition logic based on game type
    // Example for a simple game:
    if (gameState.player1.score >= gameState.winScore) {
        return 'player1';
    } else if (gameState.player2.score >= gameState.winScore) {
        return 'player2';
    }
    return null;
};

export const resetGame = () => {
    return {
        player1: { score: 0, actions: [] },
        player2: { score: 0, actions: [] },
        currentTurn: 'player1',
        winScore: 10,
    };
};