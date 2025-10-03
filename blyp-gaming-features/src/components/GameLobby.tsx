import React, { useEffect, useState } from 'react';
import { View, Text, Button, FlatList, StyleSheet } from 'react-native';
import { Game } from '../types/game';
import { fetchAvailableGames, createGame } from '../services/gameService';

const GameLobby: React.FC = () => {
    const [games, setGames] = useState<Game[]>([]);
    const [loading, setLoading] = useState<boolean>(true);

    useEffect(() => {
        const loadGames = async () => {
            setLoading(true);
            const availableGames = await fetchAvailableGames();
            setGames(availableGames);
            setLoading(false);
        };

        loadGames();
    }, []);

    const handleCreateGame = async () => {
        const newGame = await createGame();
        setGames((prevGames) => [...prevGames, newGame]);
    };

    const renderGameItem = ({ item }: { item: Game }) => (
        <View style={styles.gameCard}>
            <Text style={styles.title}>{item.title}</Text>
            <Text>{item.description}</Text>
            <Button title="Join Game" onPress={() => {/* Logic to join game */}} />
        </View>
    );

    if (loading) {
        return <Text>Loading games...</Text>;
    }

    return (
        <View style={styles.container}>
            <Text style={styles.header}>Game Lobby</Text>
            <Button title="Create New Game" onPress={handleCreateGame} />
            <FlatList
                data={games}
                renderItem={renderGameItem}
                keyExtractor={(item) => item.id.toString()}
            />
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        padding: 16,
        backgroundColor: '#fff',
    },
    header: {
        fontSize: 24,
        fontWeight: 'bold',
        marginBottom: 16,
    },
    gameCard: {
        padding: 16,
        marginVertical: 8,
        borderWidth: 1,
        borderColor: '#ccc',
        borderRadius: 8,
    },
    title: {
        fontSize: 18,
        fontWeight: 'bold',
    },
});

export default GameLobby;