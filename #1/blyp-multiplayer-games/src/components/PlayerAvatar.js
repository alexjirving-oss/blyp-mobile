import React from 'react';
import { View, Image, Text, StyleSheet } from 'react-native';

const PlayerAvatar = ({ player }) => {
  return (
    <View style={styles.container}>
      <Image source={{ uri: player.avatar }} style={styles.avatar} />
      <Text style={styles.playerName}>{player.name}</Text>
      {player.isOnline && <View style={styles.onlineIndicator} />}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    margin: 10,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
  },
  playerName: {
    color: '#fff',
    marginTop: 5,
    fontSize: 14,
    textAlign: 'center',
  },
  onlineIndicator: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#10b981',
    borderWidth: 2,
    borderColor: '#0f172a',
  },
});

export default PlayerAvatar;