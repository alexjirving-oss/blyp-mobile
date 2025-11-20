import React, { useState, useEffect } from 'react';
import Icon from '../../../../src/components/Icon';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { db } from '../config/firebase'; // Assuming you have a firebase config file
import { collection, onSnapshot } from 'firebase/firestore';

const GameLobby = ({ navigation }) => {
  const [availableGames, setAvailableGames] = useState([]);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'games'), (snapshot) => {
      const gamesData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      }));
      setAvailableGames(gamesData);
    });

    return () => unsubscribe();
  }, []);

  const handleJoinGame = (gameId) => {
    // Logic to join the selected game
    navigation.navigate('GameRoomScreen', { gameId });
  };

  const handleCreateGame = () => {
    // Logic to create a new game
    Alert.alert('Create Game', 'Game creation logic goes here.');
  };

  const renderGameItem = ({ item }) => (
    <TouchableOpacity style={styles.gameItem} onPress={() => handleJoinGame(item.id)}>
      <Text style={styles.gameTitle}>{item.title}</Text>
      <Text style={styles.gameDescription}>{item.description}</Text>
      <Icon  name="play" size={24} color="#4CAF50"  />
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Game Lobby</Text>
      <FlatList
        data={availableGames}
        renderItem={renderGameItem}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.gameList}
      />
      <TouchableOpacity style={styles.createGameButton} onPress={handleCreateGame}>
        <Text style={styles.createGameButtonText}>Create New Game</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#0f172a',
  },
  header: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 16,
  },
  gameList: {
    paddingBottom: 100,
  },
  gameItem: {
    backgroundColor: '#1e293b',
    padding: 16,
    borderRadius: 8,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  gameTitle: {
    fontSize: 18,
    color: '#ffffff',
  },
  gameDescription: {
    fontSize: 14,
    color: '#9ca3af',
  },
  createGameButton: {
    backgroundColor: '#a855f7',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  createGameButtonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
  },
});

export default GameLobby;