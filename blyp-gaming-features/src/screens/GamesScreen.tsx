import React from 'react';
import { View, FlatList, Text, StyleSheet } from 'react-native';
import GameCard from '../components/GameCard';
import { Game } from '../types/game';
import { fetchGames } from '../services/gameService';

const GamesScreen: React.FC = () => {
  const [games, setGames] = React.useState<Game[]>([]);
  const [loading, setLoading] = React.useState<boolean>(true);

  React.useEffect(() => {
    const loadGames = async () => {
      try {
        const gameList = await fetchGames();
        setGames(gameList);
      } catch (error) {
        console.error('Error fetching games:', error);
      } finally {
        setLoading(false);
      }
    };

    loadGames();
  }, []);

  const renderGameCard = ({ item }: { item: Game }) => (
    <GameCard game={item} />
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <Text>Loading games...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={games}
        renderItem={renderGameCard}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.list}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#121212',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  list: {
    paddingBottom: 16,
  },
});

export default GamesScreen;