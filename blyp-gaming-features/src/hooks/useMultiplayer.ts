import { useEffect, useState } from 'react';
import { multiplayerService } from '../services/multiplayerService';
import { Player, GameState } from '../types/multiplayer';

const useMultiplayer = (lobbyId: string) => {
    const [players, setPlayers] = useState<Player[]>([]);
    const [gameState, setGameState] = useState<GameState | null>(null);

    useEffect(() => {
        const fetchPlayers = async () => {
            const playerList = await multiplayerService.getPlayersInLobby(lobbyId);
            setPlayers(playerList);
        };

        const fetchGameState = async () => {
            const state = await multiplayerService.getGameState(lobbyId);
            setGameState(state);
        };

        fetchPlayers();
        fetchGameState();

        const handlePlayerJoined = (newPlayer: Player) => {
            setPlayers((prevPlayers) => [...prevPlayers, newPlayer]);
        };

        const handleGameStateUpdate = (updatedState: GameState) => {
            setGameState(updatedState);
        };

        multiplayerService.onPlayerJoined(lobbyId, handlePlayerJoined);
        multiplayerService.onGameStateUpdated(lobbyId, handleGameStateUpdate);

        return () => {
            multiplayerService.offPlayerJoined(lobbyId, handlePlayerJoined);
            multiplayerService.offGameStateUpdated(lobbyId, handleGameStateUpdate);
        };
    }, [lobbyId]);

    return { players, gameState };
};

export default useMultiplayer;