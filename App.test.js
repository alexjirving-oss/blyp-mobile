// TEMPORARY TEST VERSION - MINIMAL APP
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>🎉 Blyp Connection Test</Text>
      <Text style={styles.subtext}>If you see this, the development build is working!</Text>
      <Text style={styles.subtext}>The Android internal error is fixed.</Text>
      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  text: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 20,
  },
  subtext: {
    color: '#64748b',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 10,
  },
});