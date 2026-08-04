import React from 'react';
import { StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../components/Icon';
import { theme as blypTheme } from '../styles/blypTheme';

const T = blypTheme.colors;

/**
 * Voice/video calling is paused behind Coming Soon.
 * LiveKit / Telecom call UI remains in git history for when we revive it.
 */
const CallScreen = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.container, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }]}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      <View style={styles.comingSoon}>
        <Icon name="call" size={64} color="#fff" />
        <Text style={styles.title}>Calls</Text>
        <Text style={styles.subtitle}>Coming soon</Text>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => {
            try {
              if (navigation?.canGoBack?.()) navigation.goBack();
              else navigation?.navigate?.('Messenger');
            } catch {
              /* ignore */
            }
          }}
          activeOpacity={0.8}
        >
          <Text style={styles.backText}>Go back</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0C',
  },
  comingSoon: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  title: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 16,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    color: '#e5e7eb',
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
  },
  backBtn: {
    marginTop: 28,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  backText: {
    color: T.primary || '#00D2BE',
    fontSize: 15,
    fontWeight: '600',
  },
});

export default CallScreen;
