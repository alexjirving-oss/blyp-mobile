// MatchdayRoomScreen
//
// The live, match-scoped Matchday Live experience: banter chat, coin-prize
// predictions, a collective reaction gauge / emoji storms, and friends
// leaderboards. Entry is gated by a server-authoritative entitlement; arriving
// from the unlock flow the gate is already open and cached.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../components/Icon';
import { COLORS } from '../styles/theme';
import { responsiveFont, responsiveSize } from '../utils/scaleUtils';
import { useAuth } from '../hooks/useCommon';
import { getMatchWindow, formatCountdown } from '../services/matchdayService';
import { isEntitledCached, checkEntitlement } from '../services/matchdayEntitlementService';
import { subscribeToMatchdayEvents } from '../realtime/matchdayLiveSocket';
import { logMatchdayEvent } from '../services/matchdayAnalytics';
import MatchdayUnlockSheet from '../components/Matchday/MatchdayUnlockSheet';
import MatchdayChat from '../components/Matchday/MatchdayChat';
import MatchdayReactions from '../components/Matchday/MatchdayReactions';
import MatchdayPredictions from '../components/Matchday/MatchdayPredictions';
import MatchdayLeaderboard from '../components/Matchday/MatchdayLeaderboard';

const ACCENT = '#19D27C';

const TABS = [
  { key: 'banter', label: 'Banter', icon: 'chatbubbles' },
  { key: 'predict', label: 'Predict', icon: 'flash' },
  { key: 'ranks', label: 'Ranks', icon: 'trophy' },
];

export default function MatchdayRoomScreen({ route, navigation }) {
  const insets = useSafeAreaInsets();
  const { uid } = useAuth();
  const params = route?.params || {};
  const { eventId, eventMeta, teamId } = params;

  const [gate, setGate] = useState('checking'); // checking | open | locked
  const [tab, setTab] = useState('banter');
  const [now, setNow] = useState(Date.now());
  const [incoming, setIncoming] = useState(null);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const seqRef = useRef(0);

  // Entitlement guard (cache-first, then authoritative).
  useEffect(() => {
    let active = true;
    (async () => {
      if (await isEntitledCached(eventId)) {
        if (active) setGate('open');
        return;
      }
      try {
        const status = await checkEntitlement(eventId);
        if (active) setGate(status.entitled ? 'open' : 'locked');
      } catch {
        if (active) setGate('locked');
      }
    })();
    return () => {
      active = false;
    };
  }, [eventId]);

  // Clock for the header phase pill / countdown.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(id);
  }, []);

  // Single realtime subscription: reactions feed the gauge, settlement refreshes data.
  useEffect(() => {
    if (gate !== 'open' || !eventId) return undefined;
    let sub = null;
    let closed = false;
    logMatchdayEvent('room_enter', { eventId });
    subscribeToMatchdayEvents(eventId, (evt) => {
      if (!evt) return;
      if (evt.type === 'matchday_reaction') {
        setIncoming({ ...evt, _seq: seqRef.current++ });
      } else if (evt.type === 'matchday_settled') {
        setRefreshSignal((s) => s + 1);
      }
    })
      .then((s) => {
        if (closed) s.close();
        else sub = s;
      })
      .catch(() => {});
    return () => {
      closed = true;
      try {
        sub?.close();
      } catch {
        // ignore
      }
    };
  }, [gate, eventId]);

  const win = useMemo(() => getMatchWindow({ timestamp: eventMeta?.kickoff }, now), [eventMeta, now]);
  const matchup =
    eventMeta?.homeTeam && eventMeta?.awayTeam ? `${eventMeta.homeTeam} v ${eventMeta.awayTeam}` : 'Matchday Live';

  const phaseLabel = useMemo(() => {
    if (win.phase === 'live') return 'LIVE';
    if (win.phase === 'ended') return 'FULL TIME';
    if (win.phase === 'upcoming') return `KO in ${formatCountdown(win.msToKickoff)}`;
    return 'MATCHDAY';
  }, [win]);

  const goBack = useCallback(() => navigation?.goBack?.(), [navigation]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={goBack} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Icon name="chevron-back" size={responsiveFont(26)} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{matchup}</Text>
          <Text style={styles.subtitle} numberOfLines={1}>{eventMeta?.league || 'Football'}</Text>
        </View>
        <View style={[styles.phasePill, win.phase === 'live' && styles.phasePillLive]}>
          {win.phase === 'live' && <View style={styles.liveDot} />}
          <Text style={[styles.phaseText, win.phase === 'live' && styles.phaseTextLive]} numberOfLines={1}>
            {phaseLabel}
          </Text>
        </View>
      </View>

      {gate === 'open' ? (
        <>
          <View style={styles.tabs}>
            {TABS.map((t) => (
              <TouchableOpacity
                key={t.key}
                style={[styles.tab, tab === t.key && styles.tabOn]}
                onPress={() => setTab(t.key)}
              >
                <Icon name={t.icon} size={responsiveFont(16)} color={tab === t.key ? COLORS.background : COLORS.textSecondary} />
                <Text style={[styles.tabText, tab === t.key && styles.tabTextOn]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.body}>
            {tab === 'banter' && <MatchdayChat eventId={eventId} uid={uid} />}
            {tab === 'predict' && (
              <MatchdayPredictions
                eventId={eventId}
                eventMeta={eventMeta}
                teamId={teamId}
                phase={win.phase}
                refreshSignal={refreshSignal}
              />
            )}
            {tab === 'ranks' && (
              <MatchdayLeaderboard eventId={eventId} eventMeta={eventMeta} uid={uid} refreshSignal={refreshSignal} />
            )}
          </View>

          <View style={[styles.reactions, { paddingBottom: Math.max(insets.bottom, responsiveSize(10)) }]}>
            <MatchdayReactions eventId={eventId} incoming={incoming} />
          </View>
        </>
      ) : gate === 'checking' ? (
        <View style={styles.center}>
          <Icon name="football" size={responsiveFont(34)} color={ACCENT} />
          <Text style={styles.checkingText}>Opening the room…</Text>
        </View>
      ) : (
        <View style={styles.center}>
          <Icon name="lock-closed" size={responsiveFont(34)} color={COLORS.textMuted} />
          <Text style={styles.lockedText}>Unlock Matchday Live to join.</Text>
        </View>
      )}

      <MatchdayUnlockSheet
        visible={gate === 'locked'}
        eventId={eventId}
        eventMeta={eventMeta}
        uid={uid}
        onClose={goBack}
        onUnlocked={() => setGate('open')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: responsiveSize(10),
    paddingHorizontal: responsiveSize(14),
    paddingVertical: responsiveSize(10),
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  title: { color: COLORS.textPrimary, fontSize: responsiveFont(17), fontWeight: '800' },
  subtitle: { color: COLORS.textSecondary, fontSize: responsiveFont(12), marginTop: 1 },
  phasePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: responsiveSize(5),
    backgroundColor: COLORS.backgroundCard,
    borderRadius: 999,
    paddingHorizontal: responsiveSize(10),
    paddingVertical: responsiveSize(5),
  },
  phasePillLive: { backgroundColor: 'rgba(255,59,48,0.16)' },
  liveDot: { width: responsiveSize(7), height: responsiveSize(7), borderRadius: 999, backgroundColor: '#FF3B30' },
  phaseText: { color: COLORS.textSecondary, fontSize: responsiveFont(10), fontWeight: '800', letterSpacing: 0.5 },
  phaseTextLive: { color: '#FF6B61' },
  tabs: {
    flexDirection: 'row',
    gap: responsiveSize(8),
    paddingHorizontal: responsiveSize(14),
    paddingVertical: responsiveSize(10),
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: responsiveSize(6),
    paddingVertical: responsiveSize(9),
    borderRadius: responsiveSize(11),
    backgroundColor: COLORS.backgroundCard,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  tabOn: { backgroundColor: ACCENT, borderColor: ACCENT },
  tabText: { color: COLORS.textSecondary, fontSize: responsiveFont(13), fontWeight: '700' },
  tabTextOn: { color: COLORS.background },
  body: { flex: 1 },
  reactions: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    paddingTop: responsiveSize(8),
    backgroundColor: COLORS.background,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: responsiveSize(10) },
  checkingText: { color: COLORS.textSecondary, fontSize: responsiveFont(14) },
  lockedText: { color: COLORS.textMuted, fontSize: responsiveFont(14) },
});
