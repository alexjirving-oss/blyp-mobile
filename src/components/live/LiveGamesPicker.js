/**
 * Branded Games picker for server-authoritative live overlays.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import FrenemiesWheelGlyph from './frenemies/FrenemiesWheelGlyph';

const TEAL = '#FF2D55';
const GOLD = '#F5C542';
const INK = '#0A0A0C';

export default function LiveGamesPicker({
  visible,
  showMarble = true,
  showFrenemies = true,
  showReactionDuel = true,
  showBattle = false,
  battleActive = false,
  battleGameEnabled = false,
  standaloneGamesDisabled = false,
  onPickMarble,
  onPickFrenemies,
  onPickReactionDuel,
  onPickBattle,
  onClose,
}) {
  if (!visible) return null;
  if (!showMarble && !showFrenemies && !showReactionDuel && !showBattle) return null;

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

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.row}
          showsVerticalScrollIndicator={false}
        >
          {showFrenemies ? (
            <TouchableOpacity
              style={[styles.cardWrap, standaloneGamesDisabled && styles.cardDisabled]}
              onPress={onPickFrenemies}
              disabled={standaloneGamesDisabled}
              activeOpacity={0.9}
              accessibilityLabel="Play Frenemies"
              accessibilityState={{ disabled: standaloneGamesDisabled }}
            >
              <LinearGradient
                colors={['#0E3D38', '#1A1520', '#0A0A0C']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.card}
              >
                <View style={[styles.badge, { backgroundColor: TEAL }]}>
                  <Text style={[styles.badgeText, { color: '#FFFFFF' }]} allowFontScaling={false}>
                    LIVE
                  </Text>
                </View>
                <View style={styles.frenemiesGlyph}>
                  <FrenemiesWheelGlyph size={64} />
                </View>
                <Text style={styles.cardTitle} allowFontScaling={false}>
                  Frenemies
                </Text>
                <Text style={styles.cardSub} allowFontScaling={false}>
                  Host spins · throw · room challenges
                </Text>
                <View style={[styles.cta, { backgroundColor: TEAL }]}>
                  <Text style={[styles.ctaText, { color: '#FFFFFF' }]} allowFontScaling={false}>
                    {standaloneGamesDisabled ? 'Exit battle to switch' : 'Open'}
                  </Text>
                </View>
              </LinearGradient>
            </TouchableOpacity>
          ) : null}

          {showReactionDuel ? (
            <TouchableOpacity
              style={[styles.cardWrap, standaloneGamesDisabled && styles.cardDisabled]}
              onPress={onPickReactionDuel}
              disabled={standaloneGamesDisabled}
              activeOpacity={0.9}
              accessibilityLabel="Play Reaction Duel"
              accessibilityState={{ disabled: standaloneGamesDisabled }}
            >
              <LinearGradient
                colors={['#082F49', '#0A0A0C']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.card}
              >
                <View style={[styles.badge, { backgroundColor: '#22D3EE' }]}>
                  <Text style={styles.badgeText} allowFontScaling={false}>
                    HOST
                  </Text>
                </View>
                <Text style={styles.cardIcon} allowFontScaling={false}>
                  ⚡
                </Text>
                <Text style={styles.cardTitle} allowFontScaling={false}>
                  Reaction Duel
                </Text>
                <Text style={styles.cardSub} allowFontScaling={false}>
                  Entry: 100 coins each · Prize: 300 coins
                </Text>
                <View style={[styles.cta, { backgroundColor: '#22D3EE' }]}>
                  <Text style={styles.ctaText} allowFontScaling={false}>
                    {standaloneGamesDisabled ? 'Exit battle to switch' : 'Open'}
                  </Text>
                </View>
              </LinearGradient>
            </TouchableOpacity>
          ) : null}

          {showMarble ? (
            <TouchableOpacity
              style={[styles.cardWrap, standaloneGamesDisabled && styles.cardDisabled]}
              onPress={onPickMarble}
              disabled={standaloneGamesDisabled}
              activeOpacity={0.9}
              accessibilityLabel="Play Marble Race"
              accessibilityState={{ disabled: standaloneGamesDisabled }}
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
                    {standaloneGamesDisabled ? 'Exit battle to switch' : 'Open'}
                  </Text>
                </View>
              </LinearGradient>
            </TouchableOpacity>
          ) : null}

          {showBattle ? (
            <TouchableOpacity
              style={[styles.cardWrap, battleActive && !battleGameEnabled && styles.cardDisabled]}
              onPress={onPickBattle}
              disabled={battleActive && !battleGameEnabled}
              activeOpacity={0.9}
              accessibilityLabel={battleActive ? 'Open battle game' : 'Battle an on-stage guest'}
              accessibilityState={{ disabled: battleActive && !battleGameEnabled }}
            >
              <LinearGradient
                colors={['#4A1D18', '#0A0A0C']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.card}
              >
                <View style={[styles.badge, { backgroundColor: '#FF7A66' }]}>
                  <Text style={styles.badgeText} allowFontScaling={false}>
                    {battleActive ? 'ACTIVE' : 'HOST'}
                  </Text>
                </View>
                <Text style={styles.cardIcon} allowFontScaling={false}>
                  ⚔️
                </Text>
                <Text style={styles.cardTitle} allowFontScaling={false}>
                  {battleActive ? 'Battle game' : 'Battle a guest'}
                </Text>
                <Text style={styles.cardSub} allowFontScaling={false}>
                  {battleActive
                    ? battleGameEnabled
                      ? 'Open Artillery inside this live battle'
                      : 'Battle arena active · use Exit battle to leave'
                    : 'Challenge an on-stage guest · manage the arena'}
                </Text>
                <View style={[styles.cta, { backgroundColor: '#FF7A66' }]}>
                  <Text style={styles.ctaText} allowFontScaling={false}>
                    {battleActive
                      ? battleGameEnabled
                        ? 'Open game'
                        : 'Battle active'
                      : 'Choose guest'}
                  </Text>
                </View>
              </LinearGradient>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
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
    borderColor: 'rgba(255,45,85,0.35)',
    maxHeight: '82%',
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
  scroll: { flexGrow: 0 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingBottom: 2 },
  cardWrap: { flexGrow: 1, flexBasis: '45%' },
  cardDisabled: { opacity: 0.52 },
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
  frenemiesGlyph: {
    width: 68,
    height: 68,
    marginBottom: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,45,149,0.12)',
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: 'rgba(255,45,149,0.55)',
  },
  frenemiesGlyphText: { color: GOLD, fontWeight: '900', fontSize: 16 },
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
