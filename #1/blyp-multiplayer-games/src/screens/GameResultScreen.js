import React from 'react';
import { View, Text, StyleSheet, Button } from 'react-native';

const GameResultScreen = ({ route, navigation }) => {
  const { winner, scores } = route.params;

  const handlePlayAgain = () => {
    navigation.navigate('GameMenuScreen');
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Game Over</Text>
      <Text style={styles.winnerText}>{winner ? `${winner} Wins!` : 'It\'s a Draw!'}</Text>
      <Text style={styles.scoresTitle}>Final Scores:</Text>
      {scores.map((score, index) => (
        <Text key={index} style={styles.scoreText}>{score.player}: {score.points}</Text>
      ))}
      <Button title="Play Again" onPress={handlePlayAgain} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0f172a',
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 20,
  },
  winnerText: {
    fontSize: 20,
    color: '#a855f7',
    marginBottom: 10,
  },
  scoresTitle: {
    fontSize: 18,
    color: '#ffffff',
    marginBottom: 10,
  },
  scoreText: {
    fontSize: 16,
    color: '#9ca3af',
  },
});

export default GameResultScreen;