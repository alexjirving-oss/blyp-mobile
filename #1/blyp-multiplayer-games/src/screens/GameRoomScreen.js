import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, SafeAreaView, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import GameTimer from '../components/GameTimer';
import GameLeaderboard from '../components/GameLeaderboard';
import { GameManager } from '../games/GameManager';

const GameRoomScreen = ({ route }) => {
  const navigation = useNavigation();
  const { gameType, players } = route.params;
  const [gameManager, setGameManager] = useState(null);
  const [gameState, setGameState] = useState(null);

  useEffect(() => {
    const manager = new GameManager(gameType, players);
    setGameManager(manager);
    manager.startGame();

    const unsubscribe = manager.onGameStateChange((state) => {
      setGameState(state);
    });

    return () => {
      unsubscribe();
      manager.endGame();
    };
  }, [gameType, players]);

  const handleLeaveGame = () => {
    gameManager.endGame();
    navigation.navigate('GameMenuScreen');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Game Room</Text>
        <GameTimer duration={gameState?.duration} />
      </View>
      <View style={styles.content}>
        {gameState && <GameLeaderboard scores={gameState.scores} />}
        {/* Render game-specific components based on gameType */}
        {/* Example: {gameType === 'TicTacToe' && <TicTacToeBoard />} */}
      </View>
      <TouchableOpacity style={styles.leaveButton} onPress={handleLeaveGame}>
        <Text style={styles.leaveButtonText}>Leave Game</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: 'bold',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
  },
  leaveButton: {
    backgroundColor: '#a855f7',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  leaveButtonText: {
    color: '#ffffff',
    fontSize: 16,
  },
});

export default GameRoomScreen;