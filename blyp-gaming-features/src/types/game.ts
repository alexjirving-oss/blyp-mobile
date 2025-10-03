export interface Game {
    id: string;
    title: string;
    description: string;
    imageUrl: string;
    players: Player[];
    maxPlayers: number;
    createdAt: Date;
    updatedAt: Date;
}

export interface Player {
    id: string;
    name: string;
    score: number;
    isActive: boolean;
}