import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';

const GameMenuScreen = () => {
  const navigation = useNavigation();

  const handleGameSelect = (game) => {
    navigation.navigate(game);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Blyp Multiplayer Games</Text>
      <TouchableOpacity style={styles.button} onPress={() => handleGameSelect('TicTacToe')}>
        <Text style={styles.buttonText}>Tic Tac Toe</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.button} onPress={() => handleGameSelect('WordGuess')}>
        <Text style={styles.buttonText}>Word Guess</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.button} onPress={() => handleGameSelect('QuickDraw')}>
        <Text style={styles.buttonText}>Quick Draw</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.button} onPress={() => handleGameSelect('ActiveGames')}>
        <Text style={styles.buttonText}>Active Games</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0f172a',
  },
  title: {
    fontSize: 24,
    color: '#ffffff',
    marginBottom: 20,
  },
  button: {
    backgroundColor: '#a855f7',
    padding: 15,
    borderRadius: 10,
    marginVertical: 10,
    width: '80%',
    alignItems: 'center',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 18,
  },
});

export default GameMenuScreen;