import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

/**
 * Simple test component to verify basic rendering capability
 * Used as a fallback when main app components fail to render
 */
const TestRender = ({ onPress, message }) => {
  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#3b82f6', '#8b5cf6', '#d946ef']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        <Text style={styles.title}>Blyp Render Test</Text>
        <Text style={styles.subtitle}>✅ Basic Component Rendering</Text>
        
        {message && (
          <View style={styles.messageBox}>
            <Text style={styles.messageText}>{message}</Text>
          </View>
        )}
        
        <TouchableOpacity style={styles.button} onPress={onPress || (() => {})}>
          <Text style={styles.buttonText}>Continue</Text>
        </TouchableOpacity>
      </LinearGradient>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  gradient: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  title: {
    color: 'white',
    fontSize: 32,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 16,
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: -1, height: 1 },
    textShadowRadius: 10
  },
  subtitle: {
    color: 'white',
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 30,
  },
  messageBox: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    padding: 15,
    borderRadius: 10,
    marginVertical: 20,
    width: '100%',
    maxWidth: 300,
  },
  messageText: {
    color: 'white',
    textAlign: 'center',
    fontSize: 16,
  },
  button: {
    backgroundColor: 'white',
    paddingHorizontal: 30,
    paddingVertical: 12,
    borderRadius: 25,
    marginTop: 20,
  },
  buttonText: {
    color: '#8b5cf6',
    fontSize: 18,
    fontWeight: 'bold',
  }
});

export default TestRender;