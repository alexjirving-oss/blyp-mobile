import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const GameInvite = ({ invite, onAccept, onDecline }) => {
  return (
    <View style={styles.inviteContainer}>
      <Text style={styles.inviteText}>
        {invite.senderName} has invited you to play {invite.gameType}!
      </Text>
      <View style={styles.buttonContainer}>
        <TouchableOpacity style={styles.acceptButton} onPress={onAccept}>
          <Text style={styles.buttonText}>Accept</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.declineButton} onPress={onDecline}>
          <Text style={styles.buttonText}>Decline</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  inviteContainer: {
    padding: 16,
    backgroundColor: '#1e293b',
    borderRadius: 8,
    marginVertical: 8,
  },
  inviteText: {
    color: '#e2e8f0',
    fontSize: 16,
    marginBottom: 12,
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  acceptButton: {
    backgroundColor: '#10b981',
    padding: 10,
    borderRadius: 5,
    flex: 1,
    marginRight: 8,
  },
  declineButton: {
    backgroundColor: '#ef4444',
    padding: 10,
    borderRadius: 5,
    flex: 1,
  },
  buttonText: {
    color: '#ffffff',
    textAlign: 'center',
    fontWeight: 'bold',
  },
});

export default GameInvite;