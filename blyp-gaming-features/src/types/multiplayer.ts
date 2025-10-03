export interface Player {
    id: string;
    name: string;
    score: number;
}

export interface MultiplayerSession {
    lobbyId: string;
    players: Player[];
    gameState: 'waiting' | 'in-progress' | 'finished';
    createdAt: Date;
    updatedAt: Date;
}