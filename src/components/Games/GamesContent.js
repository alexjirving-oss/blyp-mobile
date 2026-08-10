// GamesContent — Chat/Games "Games" header tab.
// Mirrors the live Games picker without reviving the old create-sheet lobby.

import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Icon from '../Icon';
import { COLORS } from '../../styles/theme';
import { responsiveFont, responsiveSize } from '../../utils/scaleUtils';
import {
  isArtilleryEnabled,
  isFrenemiesEnabled,
  isMarbleRaceEnabled,
  isReactionDuelEnabled,
} from '../../config/LiveGamesFlags';
import FrenemiesRulesSheet from '../live/frenemies/FrenemiesRulesSheet';
import FrenemiesWheelGlyph from '../live/frenemies/FrenemiesWheelGlyph';

const MARBLE_ENABLED = isMarbleRaceEnabled();
const ARTILLERY_ENABLED = isArtilleryEnabled();
const FRENEMIES_ENABLED = isFrenemiesEnabled();
const REACTION_DUEL_ENABLED = isReactionDuelEnabled();

const TEAL = '#00D2BE';
const GOLD = '#F5C542';
const GOLD_SOFT = '#FDE68A';
const INK = '#0A0A0C';

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

function FrenemiesHubCard({ enabled, onOpenLive, onHowItWorks }) {
  return (
    <View style={[styles.frenemiesWrap, !enabled && styles.cardMuted]}>
      <LinearGradient
        colors={['#0E3D38', '#1A1520', '#0A0A0C']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.frenemiesCard}
      >
        <View style={styles.frenemiesTop}>
          <View style={styles.frenemiesBadge}>
            <Text style={styles.frenemiesBadgeText} allowFontScaling={false}>
              {enabled ? 'LIVE' : 'SOON'}
            </Text>
          </View>
          <View style={styles.frenemiesGlyph}>
            <FrenemiesWheelGlyph size={responsiveSize(44)} />
          </View>
        </View>
        <Text style={styles.frenemiesTitle} allowFontScaling={false}>
          Frenemies
        </Text>
        <Text style={styles.frenemiesSub} allowFontScaling={false}>
          {enabled
            ? 'Host spins · throw · room challenges'
            : 'Frenemies will return to the live Games picker when enabled.'}
        </Text>
        {enabled ? (
          <View style={styles.frenemiesSteps}>
            {[
              'Go live and invite guests on stage.',
              'Open Games → Frenemies — Rules are always one tap away.',
              'Open the show, then tap Spin when the room is ready — no auto-spin.',
            ].map((step, i) => (
              <View key={step} style={styles.frenemiesStepRow}>
                <Text style={styles.frenemiesStepNum} allowFontScaling={false}>
                  {i + 1}
                </Text>
                <Text style={styles.frenemiesStepText} allowFontScaling={false}>
                  {step}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
        {enabled ? (
          <View style={styles.frenemiesCtas}>
            <TouchableOpacity
              style={styles.frenemiesRulesBtn}
              activeOpacity={0.85}
              onPress={onHowItWorks}
            >
              <Text style={styles.frenemiesRulesText} allowFontScaling={false}>
                How it works
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.frenemiesOpenBtn} activeOpacity={0.85} onPress={onOpenLive}>
              <Text style={styles.frenemiesOpenText} allowFontScaling={false}>
                Open from Live
              </Text>
              <Icon name="chevron-forward" size={responsiveFont(16)} color={INK} />
            </TouchableOpacity>
          </View>
        ) : null}
      </LinearGradient>
    </View>
  );
}

export default function GamesContent({ navigation, onSelectChatTab }) {
  const [rulesOpen, setRulesOpen] = useState(false);

  const startFromLive = (source) => {
    try {
      navigation?.navigate?.('LiveStreamScreen', {
        mode: 'host',
        source,
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
        Everything playable lives here. Live-only games start from the Games button
        after you go live; battles open in Battle HQ.
      </Text>

      <FrenemiesHubCard
        enabled={FRENEMIES_ENABLED}
        onOpenLive={() => startFromLive('GamesFrenemies')}
        onHowItWorks={() => setRulesOpen(true)}
      />

      <GameCard
        icon="flash"
        title="Reaction Duel"
        badge={REACTION_DUEL_ENABLED ? 'Live now' : 'Coming soon'}
        body={
          REACTION_DUEL_ENABLED
            ? 'Fastest tap wins a best-of-five duel. Entry: 100 coins each. Prize: 300 coins to the winner.'
            : 'Reaction Duel will return to the live Games picker when enabled.'
        }
        steps={
          REACTION_DUEL_ENABLED
            ? [
                'Start your live and bring the opponent on stage.',
                'Tap Games → Reaction Duel.',
                'Choose the guest, start the duel, and both players lock 100 coins.',
              ]
            : null
        }
        ctaLabel={REACTION_DUEL_ENABLED ? 'Start from Live' : null}
        onCta={
          REACTION_DUEL_ENABLED
            ? () => startFromLive('GamesReactionDuel')
            : null
        }
        muted={!REACTION_DUEL_ENABLED}
      />

      <GameCard
        icon="podium-outline"
        title="Reaction Duel Ranked"
        badge="Later"
        body="Ranked matchmaking is planned, but it is not a live product yet. Use Reaction Duel in a host live now."
        muted
      />

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
        onCta={
          MARBLE_ENABLED
            ? () => startFromLive('GamesMarbleRace')
            : null
        }
        muted={!MARBLE_ENABLED}
      />

      <GameCard
        icon="game-controller"
        title="Battles"
        badge={ARTILLERY_ENABLED ? 'Battle HQ + Artillery' : 'Battle HQ'}
        body={
          ARTILLERY_ENABLED
            ? 'Arrange or review battle requests in Battle HQ. During a live battle, tap Games → Battle game to open Artillery.'
            : 'Arrange battles, review requests, and enter live arenas from Battle HQ. Artillery appears here when enabled.'
        }
        steps={[
          'Open Battle HQ to create, accept, decline, or withdraw a request.',
          'Enter the live arena when the battle is ready.',
          'Use Exit battle to leave the arena without ending the whole app.',
        ]}
        ctaLabel="Open Battle HQ"
        onCta={openBattles}
      />

      <View style={styles.lobbyCard}>
        <Icon name="time-outline" size={responsiveFont(28)} color={COLORS.textSecondary} />
        <Text style={styles.lobbyTitle}>Classic lobby</Text>
        <Text style={styles.lobbyBody}>
          Matchmaking rooms (RPS, Tic Tac Toe, and friends) stay paused. Live overlay games above are the path for now.
        </Text>
      </View>

      <FrenemiesRulesSheet visible={rulesOpen} onClose={() => setRulesOpen(false)} />
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
  frenemiesWrap: {
    borderRadius: responsiveSize(18),
    overflow: 'hidden',
    marginBottom: responsiveSize(14),
    borderWidth: 1,
    borderColor: 'rgba(245,197,66,0.38)',
  },
  frenemiesCard: {
    padding: responsiveSize(16),
  },
  frenemiesTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: responsiveSize(10),
  },
  frenemiesBadge: {
    backgroundColor: TEAL,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  frenemiesBadgeText: {
    color: INK,
    fontWeight: '900',
    fontSize: responsiveFont(10),
    letterSpacing: 1,
  },
  frenemiesGlyph: {
    width: responsiveSize(48),
    height: responsiveSize(48),
    borderRadius: responsiveSize(24),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderWidth: 0,
  },
  frenemiesGlyphText: { color: GOLD, fontWeight: '900', fontSize: responsiveFont(17) },
  frenemiesTitle: {
    color: GOLD_SOFT,
    fontWeight: '900',
    fontSize: responsiveFont(22),
    letterSpacing: 0.2,
  },
  frenemiesSub: {
    color: 'rgba(244,247,250,0.78)',
    fontWeight: '700',
    fontSize: responsiveFont(13),
    lineHeight: responsiveFont(19),
    marginTop: 6,
    marginBottom: responsiveSize(12),
  },
  frenemiesSteps: { gap: responsiveSize(8), marginBottom: responsiveSize(14) },
  frenemiesStepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: responsiveSize(10) },
  frenemiesStepNum: {
    width: responsiveSize(22),
    height: responsiveSize(22),
    borderRadius: responsiveSize(11),
    overflow: 'hidden',
    textAlign: 'center',
    lineHeight: responsiveSize(22),
    backgroundColor: 'rgba(0,210,190,0.18)',
    color: TEAL,
    fontWeight: '900',
    fontSize: responsiveFont(11),
  },
  frenemiesStepText: {
    flex: 1,
    color: 'rgba(244,247,250,0.9)',
    fontSize: responsiveFont(13),
    lineHeight: responsiveFont(19),
    fontWeight: '600',
  },
  frenemiesCtas: { gap: responsiveSize(8) },
  frenemiesRulesBtn: {
    borderRadius: responsiveSize(12),
    paddingVertical: responsiveSize(11),
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.5)',
    backgroundColor: 'rgba(0,210,190,0.12)',
  },
  frenemiesRulesText: { color: TEAL, fontWeight: '900', fontSize: responsiveFont(14) },
  frenemiesOpenBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: responsiveSize(6),
    backgroundColor: TEAL,
    borderRadius: responsiveSize(12),
    paddingVertical: responsiveSize(12),
  },
  frenemiesOpenText: { color: INK, fontWeight: '900', fontSize: responsiveFont(14) },
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
