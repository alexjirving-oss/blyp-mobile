import React from 'react';
import { View, Text, StyleSheet, StatusBar } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

/**
 * Minimal app that should render regardless of Firebase or other issues.
 * Use this to test basic rendering capabilities.
 */
export default function MinimalApp() {
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0f172a" />
      <LinearGradient
        colors={['#0f172a', '#1e293b', '#334155']}
        style={styles.gradient}
      >
        <Text style={styles.logo}>Blyp</Text>
        <Text style={styles.subtitle}>Minimal Test App</Text>
        <Text style={styles.debugText}>
          If you can see this, basic rendering is working!
        </Text>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  gradient: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  logo: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#f1f5f9',
    marginBottom: 20,
  },
  subtitle: {
    fontSize: 24,
    color: '#94a3b8',
    marginBottom: 40,
  },
  debugText: {
    fontSize: 16,
    color: '#f1f5f9',
    textAlign: 'center',
    marginHorizontal: 20,
    padding: 15,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    borderRadius: 10,
  },
});