import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { getGameHistory } from '../services/gameService';
import { GameHistoryItem } from '../types/game';

const GameHistoryScreen = () => {
  const [gameHistory, setGameHistory] = useState<GameHistoryItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const fetchGameHistory = async () => {
      try {
        const history = await getGameHistory();
        setGameHistory(history);
      } catch (error) {
        console.error('Failed to fetch game history:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchGameHistory();
  }, []);

  const renderItem = ({ item }: { item: GameHistoryItem }) => (
    <View style={styles.itemContainer}>
      <Text style={styles.title}>{item.title}</Text>
      <Text style={styles.score}>Score: {item.score}</Text>
      <Text style={styles.outcome}>Outcome: {item.outcome}</Text>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <Text>Loading...</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={gameHistory}
      renderItem={renderItem}
      keyExtractor={(item) => item.id.toString()}
      contentContainerStyle={styles.listContainer}
    />
  );
};

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContainer: {
    padding: 16,
  },
  itemContainer: {
    marginBottom: 16,
    padding: 16,
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  score: {
    fontSize: 16,
  },
  outcome: {
    fontSize: 14,
    color: 'gray',
  },
});

export default GameHistoryScreen;