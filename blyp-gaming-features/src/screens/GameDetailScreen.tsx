import React from 'react';
import { View, Text, Button, StyleSheet, ScrollView } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { Game } from '../types/game';
import { joinGame } from '../services/gameService';

const GameDetailScreen = () => {
  const route = useRoute();
  const { gameId } = route.params;

  const [gameDetails, setGameDetails] = React.useState<Game | null>(null);

  React.useEffect(() => {
    const fetchGameDetails = async () => {
      // Fetch game details from the API
      const details = await fetch(`https://api.example.com/games/${gameId}`);
      const data = await details.json();
      setGameDetails(data);
    };

    fetchGameDetails();
  }, [gameId]);

  const handleJoinGame = async () => {
    await joinGame(gameId);
    // Navigate to the multiplayer lobby or update state as needed
  };

  if (!gameDetails) {
    return (
      <View style={styles.loadingContainer}>
        <Text>Loading...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>{gameDetails.title}</Text>
      <Text style={styles.description}>{gameDetails.description}</Text>
      <Text style={styles.rulesTitle}>Rules:</Text>
      <Text style={styles.rules}>{gameDetails.rules}</Text>
      <Button title="Join Game" onPress={handleJoinGame} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#fff',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  description: {
    fontSize: 16,
    marginVertical: 8,
  },
  rulesTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 16,
  },
  rules: {
    fontSize: 14,
    marginVertical: 8,
  },
});

export default GameDetailScreen;