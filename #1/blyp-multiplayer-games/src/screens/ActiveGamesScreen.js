import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { getActiveGames } from '../services/GameService';

const ActiveGamesScreen = ({ navigation }) => {
  const [activeGames, setActiveGames] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchActiveGames = async () => {
      try {
        const games = await getActiveGames();
        setActiveGames(games);
      } catch (error) {
        console.error('Error fetching active games:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchActiveGames();
  }, []);

  const handleGamePress = (game) => {
    navigation.navigate('GameRoomScreen', { gameId: game.id });
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#a855f7" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Active Games</Text>
      <FlatList
        data={activeGames}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.gameItem}
            onPress={() => handleGamePress(item)}
          >
            <Text style={styles.gameName}>{item.name}</Text>
            <Text style={styles.gameStatus}>{item.status}</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#0f172a',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0f172a',
  },
  gameItem: {
    padding: 16,
    marginVertical: 8,
    borderRadius: 8,
    backgroundColor: '#374151',
  },
  gameName: {
    fontSize: 18,
    color: '#ffffff',
  },
  gameStatus: {
    fontSize: 14,
    color: '#9ca3af',
  },
});

export default ActiveGamesScreen;