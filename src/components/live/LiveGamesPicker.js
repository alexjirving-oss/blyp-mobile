/**
 * Branded Games picker — Frenemies vs Marble Race entry from the live Games tab.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

const TEAL = '#00D2BE';
const GOLD = '#F5C542';
const INK = '#0A0A0C';

export default function LiveGamesPicker({
  visible,
  showMarble = true,
  showFrenemies = true,
  onPickMarble,
  onPickFrenemies,
  onClose,
}) {
  if (!visible) return null;
  if (!showMarble && !showFrenemies) return null;

  return (
    <View style={styles.root} pointerEvents="box-none">
      <View style={styles.sheet}>
        <View style={styles.header}>
          <Text style={styles.kicker} allowFontScaling={false}>
            LIVE GAMES
          </Text>
          <Text style={styles.title} allowFontScaling={false}>
            Pick a game
          </Text>
          <TouchableOpacity onPress={onClose} hitSlop={12} style={styles.closeBtn}>
            <Text style={styles.closeText} allowFontScaling={false}>
              Close
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.row}>
          {showFrenemies ? (
            <TouchableOpacity
              style={styles.cardWrap}
              onPress={onPickFrenemies}
              activeOpacity={0.9}
              accessibilityLabel="Play Frenemies"
            >
              <LinearGradient
                colors={['#0E3D38', '#0A0A0C']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.card}
              >
                <View style={[styles.badge, { backgroundColor: TEAL }]}>
                  <Text style={styles.badgeText} allowFontScaling={false}>
                    ADMIN
                  </Text>
                </View>
                <Text style={styles.cardIcon} allowFontScaling={false}>
                  🎡
                </Text>
                <Text style={styles.cardTitle} allowFontScaling={false}>
                  Frenemies
                </Text>
                <Text style={styles.cardSub} allowFontScaling={false}>
                  Prize wheel · throw · HOUSE coins
                </Text>
                <View style={[styles.cta, { backgroundColor: TEAL }]}>
                  <Text style={styles.ctaText} allowFontScaling={false}>
                    Open
                  </Text>
                </View>
              </LinearGradient>
            </TouchableOpacity>
          ) : null}

          {showMarble ? (
            <TouchableOpacity
              style={styles.cardWrap}
              onPress={onPickMarble}
              activeOpacity={0.9}
              accessibilityLabel="Play Marble Race"
            >
              <LinearGradient
                colors={['#3A2A0A', '#0A0A0C']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.card}
              >
                <View style={[styles.badge, { backgroundColor: GOLD }]}>
                  <Text style={[styles.badgeText, { color: INK }]} allowFontScaling={false}>
                    HOST
                  </Text>
                </View>
                <Text style={styles.cardIcon} allowFontScaling={false}>
                  🏎️
                </Text>
                <Text style={styles.cardTitle} allowFontScaling={false}>
                  Marble Race
                </Text>
                <Text style={styles.cardSub} allowFontScaling={false}>
                  Guest Grand Prix heats
                </Text>
                <View style={[styles.cta, { backgroundColor: GOLD }]}>
                  <Text style={[styles.ctaText, { color: INK }]} allowFontScaling={false}>
                    Open
                  </Text>
                </View>
              </LinearGradient>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 58,
    justifyContent: 'flex-end',
    paddingBottom: 118,
    paddingHorizontal: 12,
  },
  sheet: {
    backgroundColor: 'rgba(10,10,12,0.94)',
    borderRadius: 20,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.35)',
  },
  header: { marginBottom: 12, paddingRight: 56 },
  kicker: {
    color: TEAL,
    fontWeight: '900',
    fontSize: 11,
    letterSpacing: 2.4,
  },
  title: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 22,
    letterSpacing: 0.2,
    marginTop: 2,
  },
  closeBtn: { position: 'absolute', right: 0, top: 0, padding: 4 },
  closeText: { color: 'rgba(255,255,255,0.55)', fontWeight: '700', fontSize: 13 },
  row: { flexDirection: 'row', gap: 10 },
  cardWrap: { flex: 1 },
  card: {
    borderRadius: 16,
    padding: 12,
    minHeight: 168,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
  },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    marginBottom: 8,
  },
  badgeText: { color: INK, fontWeight: '900', fontSize: 10, letterSpacing: 1 },
  cardIcon: { fontSize: 28, marginBottom: 6 },
  cardTitle: { color: '#fff', fontWeight: '900', fontSize: 17, letterSpacing: 0.2 },
  cardSub: {
    color: 'rgba(244,247,250,0.72)',
    fontWeight: '600',
    fontSize: 12,
    lineHeight: 16,
    marginTop: 4,
    marginBottom: 12,
    minHeight: 32,
  },
  cta: {
    marginTop: 'auto',
    borderRadius: 12,
    paddingVertical: 9,
    alignItems: 'center',
  },
  ctaText: { color: INK, fontWeight: '900', fontSize: 13 },
});
