import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

const WordGuessBoard = ({ currentWord, guessedLetters, attemptsLeft }) => {
  const renderWord = () => {
    return currentWord.split('').map((letter, index) => {
      return (
        <Text key={index} style={styles.letter}>
          {guessedLetters.includes(letter) ? letter : '_'}
        </Text>
      );
    });
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Word Guess Game</Text>
      <View style={styles.wordContainer}>
        {renderWord()}
      </View>
      <Text style={styles.attempts}>Attempts Left: {attemptsLeft}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    padding: 20,
  },
  title: {
    fontSize: 24,
    color: '#ffffff',
    marginBottom: 20,
  },
  wordContainer: {
    flexDirection: 'row',
    marginBottom: 20,
  },
  letter: {
    fontSize: 32,
    color: '#e2e8f0',
    marginHorizontal: 5,
  },
  attempts: {
    fontSize: 18,
    color: '#9ca3af',
  },
});

export default WordGuessBoard;