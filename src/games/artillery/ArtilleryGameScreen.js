import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Icon from '../../components/Icon';

/** Artillery is paused with Games — Coming Soon. */
export default function ArtilleryGameScreen({ navigation }) {
  return (
    <View style={styles.container}>
      <View style={styles.comingSoon}>
        <Icon name="game-controller" size={64} color="#fff" />
        <Text style={styles.title}>Games</Text>
        <Text style={styles.subtitle}>Coming soon</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.8}>
          <Text style={styles.backText}>Go back</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

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
    color: '#FF2D55',
    fontSize: 15,
    fontWeight: '600',
  },
});
