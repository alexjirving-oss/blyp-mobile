export const calculateScore = (baseScore: number, multipliers: number[]): number => {
    return multipliers.reduce((total, multiplier) => total * multiplier, baseScore);
};

export const rankPlayers = (scores: { playerId: string; score: number }[]): { playerId: string; rank: number }[] => {
    const sortedScores = [...scores].sort((a, b) => b.score - a.score);
    return sortedScores.map((player, index) => ({
        playerId: player.playerId,
        rank: index + 1,
    }));
};

export const getTopScores = (scores: { playerId: string; score: number }[], topN: number): { playerId: string; score: number }[] => {
    return scores
        .sort((a, b) => b.score - a.score)
        .slice(0, topN);
};