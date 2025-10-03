import React, { useEffect, useState } from 'react';
import { View, Text, Button, FlatList, StyleSheet } from 'react-native';
import { useMultiplayer } from '../hooks/useMultiplayer';
import { Player } from '../types/multiplayer';

const MultiplayerLobbyScreen = () => {
    const { lobbyId, players, joinGame, leaveGame } = useMultiplayer();
    const [gameState, setGameState] = useState('Waiting for players...');

    useEffect(() => {
        if (players.length > 0) {
            setGameState('Game is ready to start!');
        } else {
            setGameState('Waiting for players...');
        }
    }, [players]);

    const renderPlayer = ({ item }: { item: Player }) => (
        <Text style={styles.player}>{item.name}</Text>
    );

    return (
        <View style={styles.container}>
            <Text style={styles.title}>Multiplayer Lobby</Text>
            <Text style={styles.gameState}>{gameState}</Text>
            <FlatList
                data={players}
                renderItem={renderPlayer}
                keyExtractor={(item) => item.id}
                style={styles.playerList}
            />
            <Button title="Join Game" onPress={joinGame} />
            <Button title="Leave Game" onPress={leaveGame} />
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        marginBottom: 20,
    },
    gameState: {
        fontSize: 18,
        marginBottom: 10,
    },
    playerList: {
        width: '100%',
        marginBottom: 20,
    },
    player: {
        fontSize: 16,
        padding: 5,
    },
});

export default MultiplayerLobbyScreen;