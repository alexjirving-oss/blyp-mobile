import React from 'react';
import { View, Text, StyleSheet, FlatList } from 'react-native';

const GameLeaderboard = ({ leaderboardData }) => {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Leaderboard</Text>
      <FlatList
        data={leaderboardData}
        keyExtractor={(item) => item.id.toString()}
        renderItem={({ item, index }) => (
          <View style={styles.item}>
            <Text style={styles.rank}>{index + 1}</Text>
            <Text style={styles.playerName}>{item.name}</Text>
            <Text style={styles.score}>{item.score}</Text>
          </View>
        )}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#1e293b',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 16,
  },
  item: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  rank: {
    color: '#a855f7',
    fontWeight: 'bold',
  },
  playerName: {
    color: '#e2e8f0',
    flex: 1,
    marginLeft: 16,
  },
  score: {
    color: '#9ca3af',
  },
});

export default GameLeaderboard;