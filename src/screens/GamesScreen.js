import React from 'react';
import { StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import BlueScreen from '../ui/BlueScreen';
import Icon from '../components/Icon';
import BlypHeaderFlow from '../components/BlypHeaderFlow';
import { COLORS } from '../styles/theme';

/**
 * Games are paused behind Coming Soon while the rest of the app is stabilized.
 * Previous matchmaking / room UI lives in git history when we revive this surface.
 */
const GamesScreen = ({ navigation }) => (
  <BlueScreen>
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      <BlypHeaderFlow
        tabs={[{ key: 'games', label: 'Games' }]}
        matchHomePadding
        activeKey="games"
        onTabChange={() => {}}
        onMenuPress={() => navigation.goBack()}
      />
      <View style={styles.comingSoon}>
        <Icon name="game-controller" size={64} color="#fff" />
        <Text style={styles.title}>Games</Text>
        <Text style={styles.subtitle}>Coming soon</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.8}>
          <Text style={styles.backText}>Go back</Text>
        </TouchableOpacity>
      </View>
    </View>
  </BlueScreen>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.pageBackground || '#0A0A0C',
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
    color: COLORS.primary || '#00D2BE',
    fontSize: 15,
    fontWeight: '600',
  },
});

export default GamesScreen;
