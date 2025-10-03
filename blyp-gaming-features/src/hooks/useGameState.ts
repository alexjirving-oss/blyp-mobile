import { useEffect, useState } from 'react';
import { fetchGameData, updateGameState } from '../services/gameService';
import { Game } from '../types/game';

const useGameState = (gameId: string) => {
    const [game, setGame] = useState<Game | null>(null);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const loadGameData = async () => {
            try {
                setLoading(true);
                const gameData = await fetchGameData(gameId);
                setGame(gameData);
            } catch (err) {
                setError('Failed to load game data');
            } finally {
                setLoading(false);
            }
        };

        loadGameData();
    }, [gameId]);

    const updateState = async (newState: Partial<Game>) => {
        if (game) {
            try {
                const updatedGame = await updateGameState(gameId, newState);
                setGame(updatedGame);
            } catch (err) {
                setError('Failed to update game state');
            }
        }
    };

    return { game, loading, error, updateState };
};

export default useGameState;