import { io, Socket } from 'socket.io-client';
import { MultiplayerSession, Player } from '../types/multiplayer';

const socket: Socket = io('http://your-server-url'); // Replace with your server URL

export const createLobby = (gameId: string, player: Player) => {
    socket.emit('createLobby', { gameId, player });
};

export const joinLobby = (lobbyId: string, player: Player) => {
    socket.emit('joinLobby', { lobbyId, player });
};

export const leaveLobby = (lobbyId: string, playerId: string) => {
    socket.emit('leaveLobby', { lobbyId, playerId });
};

export const startGame = (lobbyId: string) => {
    socket.emit('startGame', { lobbyId });
};

export const onLobbyUpdate = (callback: (session: MultiplayerSession) => void) => {
    socket.on('lobbyUpdate', callback);
};

export const onGameStart = (callback: (gameData: any) => void) => {
    socket.on('gameStart', callback);
};

export const onPlayerDisconnected = (callback: (playerId: string) => void) => {
    socket.on('playerDisconnected', callback);
};

export const disconnect = () => {
    socket.disconnect();
};