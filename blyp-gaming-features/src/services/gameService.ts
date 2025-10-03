import { Game } from '../types/game';

const API_URL = 'https://api.blyp.com/games';

export const fetchGames = async (): Promise<Game[]> => {
    const response = await fetch(`${API_URL}`);
    if (!response.ok) {
        throw new Error('Failed to fetch games');
    }
    return response.json();
};

export const createGame = async (gameData: Omit<Game, 'id'>): Promise<Game> => {
    const response = await fetch(`${API_URL}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(gameData),
    });
    if (!response.ok) {
        throw new Error('Failed to create game');
    }
    return response.json();
};

export const updateGame = async (gameId: string, gameData: Partial<Game>): Promise<Game> => {
    const response = await fetch(`${API_URL}/${gameId}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(gameData),
    });
    if (!response.ok) {
        throw new Error('Failed to update game');
    }
    return response.json();
};