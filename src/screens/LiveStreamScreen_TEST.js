import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';

const LiveStreamScreen = () => {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Live Stream Test</Text>
      <Text style={styles.subtitle}>Navigation worked! Screen loaded successfully.</Text>
      <TouchableOpacity 
        style={styles.button} 
        onPress={() => Alert.alert('Success', 'LiveStreamScreen is working! The crash was in the complex code, not navigation.')}
      >
        <Text style={styles.buttonText}>Test Alert</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'black',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  title: {
    color: 'white',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 10,
    textAlign: 'center',
  },
  subtitle: {
    color: 'white',
    fontSize: 16,
    marginBottom: 30,
    textAlign: 'center',
    opacity: 0.8,
  },
  button: {
    backgroundColor: '#FF1744',
    paddingHorizontal: 30,
    paddingVertical: 15,
    borderRadius: 25,
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default LiveStreamScreen;