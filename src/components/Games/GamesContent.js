// GamesContent — Chat/Games "Games" header tab.
// Surfaces live-overlay games (Marble Race, Artillery) without reviving the
// old create-sheet / matchmaking lobby.

import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import Icon from '../Icon';
import { COLORS } from '../../styles/theme';
import { responsiveFont, responsiveSize } from '../../utils/scaleUtils';

const MARBLE_ENABLED = /^(1|true|yes|on)$/i.test(
  String(process.env.EXPO_PUBLIC_LIVE_MARBLE_RACE_ENABLED || '').trim()
);
const ARTILLERY_ENABLED = /^(1|true|yes|on)$/i.test(
  String(process.env.EXPO_PUBLIC_LIVE_ARTILLERY_ENABLED || '').trim()
);

function GameCard({ icon, title, badge, body, steps, ctaLabel, onCta, muted }) {
  return (
    <View style={[styles.card, muted && styles.cardMuted]}>
      <View style={styles.cardHeader}>
        <View style={styles.iconWrap}>
          <Icon name={icon} size={responsiveFont(22)} color={COLORS.primary} />
        </View>
        <View style={styles.cardHeaderText}>
          <Text style={styles.cardTitle}>{title}</Text>
          {badge ? <Text style={styles.badge}>{badge}</Text> : null}
        </View>
      </View>
      <Text style={styles.cardBody}>{body}</Text>
      {steps?.length ? (
        <View style={styles.steps}>
          {steps.map((step, i) => (
            <View key={step} style={styles.stepRow}>
              <Text style={styles.stepNum}>{i + 1}</Text>
              <Text style={styles.stepText}>{step}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {ctaLabel && onCta ? (
        <TouchableOpacity style={styles.cta} activeOpacity={0.85} onPress={onCta}>
          <Text style={styles.ctaText}>{ctaLabel}</Text>
          <Icon name="chevron-forward" size={responsiveFont(16)} color="#0A0A0C" />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export default function GamesContent({ navigation, onSelectChatTab }) {
  const startFromLive = () => {
    try {
      navigation?.navigate?.('LiveStreamScreen', {
        mode: 'host',
        source: 'GamesMarbleRace',
      });
    } catch {
      try {
        navigation?.navigate?.('Chat');
      } catch {
        /* ignore */
      }
      onSelectChatTab?.('notifications');
    }
  };

  const openBattles = () => {
    onSelectChatTab?.('battles');
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.lead}>
        Play during live streams. These games ride on top of Live and Battles — no separate lobby create sheet.
      </Text>

      <GameCard
        icon="flash"
        title="Marble Race"
        badge={MARBLE_ENABLED ? 'From your live' : 'Coming soon'}
        body={
          MARBLE_ENABLED
            ? 'Guest Grand Prix — translucent race overlay on your live. Hosts tap Marble Race; solo practice works, and guests join when they are on stage.'
            : 'Guest Grand Prix will open from your live once the race flag is on in this build.'
        }
        steps={
          MARBLE_ENABLED
            ? [
                'Go Live from your account (Start from Live below).',
                'On your live overlay, tap the orange Race / Marble Race button.',
                'Solo practice starts immediately; invite guests from chat for a full grid.',
              ]
            : ['Open Live when Marble Race ships in your build.', 'Host a stream and tap Race on the overlay.']
        }
        ctaLabel={MARBLE_ENABLED ? 'Start from Live' : null}
        onCta={MARBLE_ENABLED ? startFromLive : null}
        muted={!MARBLE_ENABLED}
      />

      <GameCard
        icon="game-controller"
        title="Battle game (Artillery)"
        badge={ARTILLERY_ENABLED ? 'In live battles' : 'Coming soon'}
        body={
          ARTILLERY_ENABLED
            ? 'Server-authoritative artillery stage during head-to-head battles. Open a battle stream and tap Battle game.'
            : 'Artillery opens from battle streams when enabled for this build.'
        }
        steps={
          ARTILLERY_ENABLED
            ? [
                'Open Chat → Battles and join or start a live battle.',
                'In the battle stream, tap Battle game.',
                'Play the stage — host and opponent roles are wired from the battle.',
              ]
            : ['Find a live battle under Battles when Artillery is on.']
        }
        ctaLabel={ARTILLERY_ENABLED ? 'Open Battles' : null}
        onCta={ARTILLERY_ENABLED ? openBattles : null}
        muted={!ARTILLERY_ENABLED}
      />

      <View style={styles.lobbyCard}>
        <Icon name="time-outline" size={responsiveFont(28)} color={COLORS.textSecondary} />
        <Text style={styles.lobbyTitle}>Classic lobby</Text>
        <Text style={styles.lobbyBody}>
          Matchmaking rooms (RPS, Tic Tac Toe, and friends) stay paused. Live overlay games above are the path for now.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: responsiveSize(16), paddingBottom: responsiveSize(40) },
  lead: {
    color: COLORS.textSecondary,
    fontSize: responsiveFont(13),
    lineHeight: responsiveFont(19),
    marginBottom: responsiveSize(18),
  },
  card: {
    backgroundColor: COLORS.backgroundCard,
    borderRadius: responsiveSize(16),
    padding: responsiveSize(16),
    marginBottom: responsiveSize(14),
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.22)',
  },
  cardMuted: {
    borderColor: 'rgba(255,255,255,0.06)',
    opacity: 0.92,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: responsiveSize(12), marginBottom: responsiveSize(10) },
  iconWrap: {
    width: responsiveSize(44),
    height: responsiveSize(44),
    borderRadius: responsiveSize(22),
    backgroundColor: 'rgba(0,210,190,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardHeaderText: { flex: 1 },
  cardTitle: { color: COLORS.textPrimary, fontWeight: '800', fontSize: responsiveFont(16) },
  badge: {
    marginTop: 3,
    color: COLORS.primary,
    fontWeight: '700',
    fontSize: responsiveFont(11),
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  cardBody: {
    color: COLORS.textSecondary,
    fontSize: responsiveFont(13),
    lineHeight: responsiveFont(19),
    marginBottom: responsiveSize(12),
  },
  steps: { gap: responsiveSize(8), marginBottom: responsiveSize(14) },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: responsiveSize(10) },
  stepNum: {
    width: responsiveSize(22),
    height: responsiveSize(22),
    borderRadius: responsiveSize(11),
    overflow: 'hidden',
    textAlign: 'center',
    lineHeight: responsiveSize(22),
    backgroundColor: 'rgba(255,255,255,0.08)',
    color: COLORS.textPrimary,
    fontWeight: '800',
    fontSize: responsiveFont(11),
  },
  stepText: { flex: 1, color: COLORS.textPrimary, fontSize: responsiveFont(13), lineHeight: responsiveFont(19) },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: responsiveSize(6),
    backgroundColor: COLORS.primary,
    borderRadius: responsiveSize(12),
    paddingVertical: responsiveSize(12),
  },
  ctaText: { color: '#0A0A0C', fontWeight: '800', fontSize: responsiveFont(14) },
  lobbyCard: {
    alignItems: 'center',
    paddingVertical: responsiveSize(28),
    paddingHorizontal: responsiveSize(16),
    borderRadius: responsiveSize(16),
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    gap: responsiveSize(8),
  },
  lobbyTitle: { color: COLORS.textPrimary, fontWeight: '700', fontSize: responsiveFont(15) },
  lobbyBody: {
    color: COLORS.textSecondary,
    fontSize: responsiveFont(12),
    textAlign: 'center',
    lineHeight: responsiveFont(18),
  },
});
