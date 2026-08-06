// BattlesContent — Battle HQ (Chat/Games "Battles" tab).
// Central place for live / upcoming / past battles, invites, promote, and
// team-aware filters. Builds on existing battleService subscriptions.

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  RefreshControl,
  Animated,
  Easing,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Icon from '../Icon';
import PressableLift from '../motion/PressableLift';
import { COLORS } from '../../styles/theme';
import { responsiveFont, responsiveSize } from '../../utils/scaleUtils';
import { useAuth } from '../../hooks/useCommon';
import {
  subscribeUpcomingBattles,
  subscribePendingInvites,
  subscribeMyBattles,
  isStaked,
  BATTLE_STATUS,
} from '../../services/battleService';
import { getMyMembership, subscribeTeamBattles } from '../../services/teamsService';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'live', label: 'Live' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'team', label: 'My team' },
  { key: 'past', label: 'Past' },
];

function startLabel(ms) {
  try {
    const d = new Date(ms);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const isTomorrow = d.toDateString() === tomorrow.toDateString();
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (sameDay) return `Today ${time}`;
    if (isTomorrow) return `Tomorrow ${time}`;
    return `${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} ${time}`;
  } catch {
    return 'Soon';
  }
}

function pastLabel(ms) {
  try {
    return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

function Avatar({ uri, name }) {
  if (uri) return <Image source={{ uri }} style={styles.avatar} />;
  const initial = String(name || '?').charAt(0).toUpperCase();
  return (
    <View style={[styles.avatar, styles.avatarFallback]}>
      <Text style={styles.avatarInitial}>{initial}</Text>
    </View>
  );
}

function BattleCard({ battle, onPress, past }) {
  const live = battle.status === BATTLE_STATUS.LIVE;
  return (
    <PressableLift onPress={onPress} style={styles.card} contentStyle={styles.cardInner}>
      {live && (
        <View style={styles.cardLiveStrip}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>LIVE NOW</Text>
        </View>
      )}
      <View style={styles.cardVs}>
        <View style={styles.side}>
          <Avatar uri={battle.creatorPhoto} name={battle.creatorName} />
          <Text style={styles.sideName} numberOfLines={1}>{battle.creatorName || 'Creator'}</Text>
        </View>
        <View style={styles.vsBadge}>
          <Text style={styles.vsText}>VS</Text>
        </View>
        <View style={styles.side}>
          <Avatar uri={battle.opponentPhoto || battle.bPhoto} name={battle.opponentName || battle.bName} />
          <Text style={styles.sideName} numberOfLines={1}>
            {battle.opponentName || battle.bName || 'Opponent'}
          </Text>
        </View>
      </View>

      <Text style={styles.cardTitle} numberOfLines={1}>
        {battle.title || `${battle.creatorName || battle.aName || 'Battle'} vs ${battle.opponentName || battle.bName || ''}`}
      </Text>

      <View style={styles.cardMetaRow}>
        {live ? null : past ? (
          <View style={styles.metaChip}>
            <Icon name="trophy-outline" size={responsiveFont(13)} color={COLORS.textSecondary} />
            <Text style={styles.metaChipText}>
              {pastLabel(battle.completedAt || battle.scheduledStartAt || battle.scheduledAt)}
            </Text>
          </View>
        ) : (
          <View style={styles.metaChip}>
            <Icon name="time-outline" size={responsiveFont(13)} color={COLORS.textSecondary} />
            <Text style={styles.metaChipText}>
              {startLabel(battle.scheduledStartAt || battle.scheduledAt)}
            </Text>
          </View>
        )}
        {isStaked(battle) && (
          <View style={[styles.metaChip, styles.stakeChip]}>
            <Icon name="server-outline" size={responsiveFont(13)} color={COLORS.primary} />
            <Text style={[styles.metaChipText, { color: COLORS.primary }]}>{battle.stakeCoins} coins</Text>
          </View>
        )}
        {!!battle.teamId && (
          <View style={[styles.metaChip, styles.teamChip]}>
            <Icon name="people-outline" size={responsiveFont(13)} color={COLORS.primary} />
            <Text style={[styles.metaChipText, { color: COLORS.primary }]}>Team</Text>
          </View>
        )}
      </View>
    </PressableLift>
  );
}

function HqAction({ icon, label, sub, onPress, accent }) {
  return (
    <PressableLift onPress={onPress} style={[styles.hqAction, accent && styles.hqActionAccent]} contentStyle={styles.hqActionInner}>
      <Icon name={icon} size={responsiveFont(18)} color={accent ? '#0A0A0C' : COLORS.primary} />
      <View style={styles.hqActionBody}>
        <Text style={[styles.hqActionText, accent && styles.hqActionTextAccent]}>{label}</Text>
        {!!sub && <Text style={[styles.hqActionSub, accent && styles.hqActionSubAccent]} numberOfLines={1}>{sub}</Text>}
      </View>
    </PressableLift>
  );
}

export default function BattlesContent({ navigation }) {
  const { uid } = useAuth();
  const [battles, setBattles] = useState([]);
  const [invites, setInvites] = useState([]);
  const [outgoing, setOutgoing] = useState([]);
  const [myHistory, setMyHistory] = useState([]);
  const [teamBattles, setTeamBattles] = useState([]);
  const [teamId, setTeamId] = useState(null);
  const [teamName, setTeamName] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [filter, setFilter] = useState('all');

  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  useEffect(() => {
    const unsub = subscribeUpcomingBattles((rows) => {
      setBattles(rows);
      setLoading(false);
    });
    return () => { try { unsub && unsub(); } catch {} };
  }, [reloadKey]);

  useEffect(() => {
    if (!uid) return undefined;
    const unsub = subscribePendingInvites(uid, setInvites);
    return () => { try { unsub && unsub(); } catch {} };
  }, [uid, reloadKey]);

  useEffect(() => {
    if (!uid) {
      setOutgoing([]);
      setMyHistory([]);
      return undefined;
    }
    const unsub = subscribeMyBattles(uid, (rows) => {
      const list = rows || [];
      setOutgoing(list.filter((b) => b.status === BATTLE_STATUS.PENDING && b.creatorUid === uid));
      setMyHistory(
        list.filter((b) =>
          [BATTLE_STATUS.COMPLETED, BATTLE_STATUS.CANCELLED, BATTLE_STATUS.REJECTED, BATTLE_STATUS.EXPIRED].includes(b.status)
        )
      );
    });
    return () => { try { unsub && unsub(); } catch {} };
  }, [uid, reloadKey]);

  useEffect(() => {
    let cancelled = false;
    let unsubTeam = null;
    (async () => {
      if (!uid) {
        setTeamId(null);
        setTeamName(null);
        setTeamBattles([]);
        return;
      }
      const m = await getMyMembership(uid);
      if (cancelled) return;
      const id = m?.teamId || null;
      setTeamId(id);
      setTeamName(m?.team?.name || null);
      if (id) {
        unsubTeam = subscribeTeamBattles(id, setTeamBattles);
      } else {
        setTeamBattles([]);
      }
    })();
    return () => {
      cancelled = true;
      try { unsubTeam && unsubTeam(); } catch {}
    };
  }, [uid, reloadKey]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setReloadKey((k) => k + 1);
    setTimeout(() => setRefreshing(false), 900);
  }, []);

  const openDetail = useCallback(
    (battleId) => {
      if (!battleId) return;
      // teamBattles use a different collection — open MyTeam for those without a public battle id link
      navigation?.navigate?.('BattleDetail', { battleId });
    },
    [navigation]
  );

  const openCreate = useCallback(() => {
    navigation?.navigate?.('CreateBattle', teamId ? { teamId, teamName } : undefined);
  }, [navigation, teamId, teamName]);

  const openRooms = useCallback(() => navigation?.navigate?.('Rooms'), [navigation]);
  const openLeaderboard = useCallback(() => navigation?.navigate?.('BattleLeaderboard'), [navigation]);
  const openDiary = useCallback(() => navigation?.navigate?.('BattleDiary'), [navigation]);
  const openPromote = useCallback(() => {
    navigation?.navigate?.('Profile', { openPromote: true, promoteMethodId: 'battle' });
  }, [navigation]);
  const openMyTeam = useCallback(() => navigation?.navigate?.('MyTeam'), [navigation]);

  const liveCount = useMemo(
    () => battles.filter((b) => b.status === BATTLE_STATUS.LIVE).length,
    [battles]
  );

  const filtered = useMemo(() => {
    if (filter === 'live') return battles.filter((b) => b.status === BATTLE_STATUS.LIVE);
    if (filter === 'upcoming') {
      return battles.filter((b) => b.status === BATTLE_STATUS.SCHEDULED || b.status === BATTLE_STATUS.PENDING);
    }
    if (filter === 'past') return myHistory;
    if (filter === 'team') {
      // Prefer public battles tagged with teamId; fall back to teamBattles list shape
      const publicTeam = battles.filter((b) => b.teamId && String(b.teamId) === String(teamId));
      if (publicTeam.length) return publicTeam;
      return (teamBattles || []).map((b) => ({
        id: b.id,
        title: `${b.aName || 'A'} vs ${b.bName || 'B'}`,
        creatorName: b.aName,
        opponentName: b.bName,
        status: b.status === 'live' ? BATTLE_STATUS.LIVE : BATTLE_STATUS.SCHEDULED,
        scheduledStartAt: typeof b.scheduledAt?.toMillis === 'function' ? b.scheduledAt.toMillis() : Number(b.scheduledAt) || Date.now(),
        teamId: b.teamId || teamId,
        _teamInternal: true,
      }));
    }
    return battles;
  }, [filter, battles, myHistory, teamBattles, teamId]);

  const pulseOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.2, 0.45] });

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
    >
      <View style={styles.hero}>
        <Animated.View style={[styles.heroGlow, { opacity: pulseOpacity }]} pointerEvents="none">
          <LinearGradient
            colors={['rgba(0,210,190,0.4)', 'rgba(0,168,158,0.05)', 'transparent']}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
        <Text style={styles.heroEyebrow}>Battle HQ</Text>
        <Text style={styles.heroTitle}>Stage your next fight</Text>
        <Text style={styles.heroSub}>
          Prearrange, promote, and jump into live dual stages — pledges and guest slots live on each battle.
        </Text>
        <View style={styles.heroStats}>
          <View style={styles.heroStat}>
            <Text style={styles.heroStatValue}>{liveCount > 0 ? liveCount : '—'}</Text>
            <Text style={styles.heroStatLabel}>Live</Text>
          </View>
          <View style={styles.heroStatDivider} />
          <View style={styles.heroStat}>
            <Text style={styles.heroStatValue}>{battles.length > 0 ? battles.length : '—'}</Text>
            <Text style={styles.heroStatLabel}>Upcoming</Text>
          </View>
          <View style={styles.heroStatDivider} />
          <View style={styles.heroStat}>
            <Text style={styles.heroStatValue}>{invites.length > 0 ? invites.length : '—'}</Text>
            <Text style={styles.heroStatLabel}>Challenges</Text>
          </View>
        </View>
      </View>

      <View style={styles.hqGrid}>
        <HqAction icon="flash" label="Prearrange" sub="Pick opponent & time" onPress={openCreate} accent />
        <HqAction icon="megaphone-outline" label="Promote" sub="Studio · battle boost+" onPress={openPromote} />
        <HqAction icon="trophy-outline" label="Leaderboard" sub="Glory ranks" onPress={openLeaderboard} />
        <HqAction icon="ribbon-outline" label="Diary" sub="Your history" onPress={openDiary} />
      </View>

      {teamId ? (
        <TouchableOpacity style={styles.teamBanner} activeOpacity={0.88} onPress={openMyTeam}>
          <Icon name="people" size={responsiveFont(18)} color={COLORS.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.teamBannerTitle}>{teamName || 'Your team'}</Text>
            <Text style={styles.teamBannerSub}>Open team dashboard · filter battles by team</Text>
          </View>
          <Icon name="chevron-forward" size={responsiveFont(18)} color={COLORS.textSecondary} />
        </TouchableOpacity>
      ) : null}

      <TouchableOpacity style={styles.roomsButton} activeOpacity={0.9} onPress={openRooms}>
        <Icon name="people" size={responsiveFont(18)} color={COLORS.primary} />
        <View style={styles.roomsButtonBody}>
          <Text style={styles.roomsButtonText}>Browse video rooms</Text>
          <Text style={styles.roomsButtonSub}>Hop into a topic and grab a guest seat</Text>
        </View>
        <Icon name="chevron-forward" size={responsiveFont(18)} color={COLORS.textSecondary} />
      </TouchableOpacity>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        {FILTERS.map((f) => {
          const on = filter === f.key;
          const disabled = f.key === 'team' && !teamId;
          return (
            <TouchableOpacity
              key={f.key}
              style={[styles.filterChip, on && styles.filterChipOn, disabled && styles.filterChipDisabled]}
              onPress={() => !disabled && setFilter(f.key)}
              disabled={disabled}
            >
              <Text style={[styles.filterText, on && styles.filterTextOn]}>{f.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {invites.length > 0 && filter !== 'past' && filter !== 'team' && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Challenges for you</Text>
          {invites.map((b) => (
            <TouchableOpacity key={b.id} style={styles.inviteRow} activeOpacity={0.85} onPress={() => openDetail(b.id)}>
              <Avatar uri={b.creatorPhoto} name={b.creatorName} />
              <View style={styles.inviteBody}>
                <Text style={styles.inviteName} numberOfLines={1}>{b.creatorName} challenged you</Text>
                <Text style={styles.inviteMeta} numberOfLines={1}>
                  {startLabel(b.scheduledStartAt)}{isStaked(b) ? ` · ${b.stakeCoins} coins` : ''}
                </Text>
              </View>
              <Icon name="chevron-forward" size={responsiveFont(18)} color={COLORS.textSecondary} />
            </TouchableOpacity>
          ))}
        </View>
      )}

      {outgoing.length > 0 && filter === 'all' && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Waiting on reply</Text>
          {outgoing.map((b) => (
            <TouchableOpacity key={b.id} style={styles.inviteRow} activeOpacity={0.85} onPress={() => openDetail(b.id)}>
              <Avatar uri={b.opponentPhoto} name={b.opponentName} />
              <View style={styles.inviteBody}>
                <Text style={styles.inviteName} numberOfLines={1}>Challenge to {b.opponentName}</Text>
                <Text style={styles.inviteMeta} numberOfLines={1}>
                  {startLabel(b.scheduledStartAt)}{isStaked(b) ? ` · ${b.stakeCoins} coins` : ''} · pending
                </Text>
              </View>
              <Icon name="chevron-forward" size={responsiveFont(18)} color={COLORS.textSecondary} />
            </TouchableOpacity>
          ))}
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          {filter === 'past' ? 'Past battles' : filter === 'team' ? 'Team battles' : filter === 'live' ? 'Live now' : 'Board'}
        </Text>
        {loading && filter !== 'past' && filter !== 'team' ? (
          <Text style={styles.emptyText}>Loading battles…</Text>
        ) : filtered.length === 0 ? (
          <View style={styles.empty}>
            <Icon name="flash-outline" size={responsiveFont(40)} color={COLORS.textSecondary} />
            <Text style={styles.emptyText}>
              {filter === 'team'
                ? 'No team battles yet.'
                : filter === 'past'
                  ? 'No past battles in your diary yet.'
                  : filter === 'live'
                    ? 'Nothing live right now.'
                    : 'No battles scheduled yet.'}
            </Text>
            <Text style={styles.emptySub}>
              {filter === 'team'
                ? 'Set one up from your team dashboard.'
                : 'Be the first — challenge someone to a battle.'}
            </Text>
            {(filter === 'all' || filter === 'upcoming' || filter === 'team') && (
              <PressableLift style={styles.emptyCta} contentStyle={styles.emptyCtaInner} onPress={filter === 'team' ? openMyTeam : openCreate}>
                <Text style={styles.emptyCtaText}>{filter === 'team' ? 'Open team' : 'Prearrange a battle'}</Text>
              </PressableLift>
            )}
          </View>
        ) : (
          filtered.map((b) => (
            <BattleCard
              key={b.id}
              battle={b}
              past={filter === 'past'}
              onPress={() => {
                if (b._teamInternal) {
                  openMyTeam();
                  return;
                }
                openDetail(b.id);
              }}
            />
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: responsiveSize(16), paddingBottom: responsiveSize(48) },
  hero: {
    borderRadius: responsiveSize(22),
    overflow: 'hidden',
    backgroundColor: '#0E1214',
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.22)',
    padding: responsiveSize(18),
    marginBottom: responsiveSize(16),
  },
  heroGlow: { ...StyleSheet.absoluteFillObject },
  heroEyebrow: {
    color: COLORS.primary,
    fontSize: responsiveFont(11),
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  heroTitle: {
    color: COLORS.textPrimary,
    fontSize: responsiveFont(26),
    fontWeight: '900',
    letterSpacing: -0.4,
    marginTop: responsiveSize(6),
  },
  heroSub: {
    color: COLORS.textSecondary,
    fontSize: responsiveFont(13),
    lineHeight: responsiveFont(19),
    marginTop: responsiveSize(8),
  },
  heroStats: {
    flexDirection: 'row',
    marginTop: responsiveSize(16),
    paddingTop: responsiveSize(14),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  heroStat: { flex: 1, alignItems: 'center' },
  heroStatValue: { color: COLORS.textPrimary, fontSize: responsiveFont(18), fontWeight: '900' },
  heroStatLabel: {
    color: COLORS.textMuted,
    fontSize: responsiveFont(10),
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 4,
  },
  heroStatDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.06)' },
  hqGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: responsiveSize(10),
    marginBottom: responsiveSize(14),
  },
  hqAction: {
    width: '48%',
    flexGrow: 1,
    borderRadius: responsiveSize(14),
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.28)',
    backgroundColor: 'rgba(0,210,190,0.06)',
    overflow: 'hidden',
  },
  hqActionAccent: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  hqActionInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: responsiveSize(10),
    padding: responsiveSize(12),
  },
  hqActionBody: { flex: 1 },
  hqActionText: { color: COLORS.textPrimary, fontWeight: '800', fontSize: responsiveFont(13) },
  hqActionTextAccent: { color: '#0A0A0C' },
  hqActionSub: { color: COLORS.textMuted, fontSize: responsiveFont(11), marginTop: 2 },
  hqActionSubAccent: { color: 'rgba(10,10,12,0.65)' },
  teamBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: responsiveSize(12),
    backgroundColor: 'rgba(0,210,190,0.08)',
    borderRadius: responsiveSize(14),
    padding: responsiveSize(14),
    marginBottom: responsiveSize(12),
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.25)',
  },
  teamBannerTitle: { color: COLORS.textPrimary, fontWeight: '800', fontSize: responsiveFont(14) },
  teamBannerSub: { color: COLORS.textSecondary, fontSize: responsiveFont(12), marginTop: 2 },
  roomsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: responsiveSize(12),
    backgroundColor: COLORS.backgroundCard,
    borderRadius: responsiveSize(14),
    padding: responsiveSize(14),
    marginBottom: responsiveSize(14),
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.18)',
  },
  roomsButtonBody: { flex: 1 },
  roomsButtonText: { color: COLORS.textPrimary, fontWeight: '700', fontSize: responsiveFont(14) },
  roomsButtonSub: { color: COLORS.textSecondary, fontSize: responsiveFont(12), marginTop: 2 },
  filterRow: { gap: responsiveSize(8), paddingBottom: responsiveSize(14) },
  filterChip: {
    paddingHorizontal: responsiveSize(14),
    paddingVertical: responsiveSize(8),
    borderRadius: responsiveSize(20),
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  filterChipOn: { backgroundColor: 'rgba(0,210,190,0.16)', borderColor: COLORS.primary },
  filterChipDisabled: { opacity: 0.35 },
  filterText: { color: COLORS.textSecondary, fontWeight: '700', fontSize: responsiveFont(12) },
  filterTextOn: { color: COLORS.primary },
  section: { marginBottom: responsiveSize(22) },
  sectionTitle: {
    color: COLORS.textPrimary,
    fontWeight: '700',
    fontSize: responsiveFont(13),
    marginBottom: responsiveSize(12),
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.backgroundCard,
    borderRadius: responsiveSize(12),
    padding: responsiveSize(12),
    marginBottom: responsiveSize(10),
    gap: responsiveSize(12),
  },
  inviteBody: { flex: 1 },
  inviteName: { color: COLORS.textPrimary, fontWeight: '700', fontSize: responsiveFont(14) },
  inviteMeta: { color: COLORS.textSecondary, fontSize: responsiveFont(12), marginTop: 2 },
  card: {
    backgroundColor: COLORS.backgroundCard,
    borderRadius: responsiveSize(16),
    marginBottom: responsiveSize(12),
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    overflow: 'hidden',
  },
  cardInner: { padding: responsiveSize(16) },
  cardLiveStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: responsiveSize(6),
    marginBottom: responsiveSize(10),
    backgroundColor: 'rgba(239,68,68,0.15)',
    borderRadius: responsiveSize(20),
    paddingVertical: responsiveSize(4),
    paddingHorizontal: responsiveSize(10),
  },
  cardVs: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  side: { alignItems: 'center', flex: 1 },
  sideName: {
    color: COLORS.textPrimary,
    fontSize: responsiveFont(13),
    fontWeight: '600',
    marginTop: responsiveSize(6),
    maxWidth: responsiveSize(110),
  },
  vsBadge: {
    width: responsiveSize(40),
    height: responsiveSize(40),
    borderRadius: responsiveSize(20),
    backgroundColor: 'rgba(0,210,190,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: responsiveSize(8),
  },
  vsText: { color: COLORS.primary, fontWeight: '900', fontSize: responsiveFont(14) },
  avatar: { width: responsiveSize(56), height: responsiveSize(56), borderRadius: responsiveSize(28), backgroundColor: '#222' },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: COLORS.textPrimary, fontWeight: '800', fontSize: responsiveFont(22) },
  cardTitle: {
    color: COLORS.textPrimary,
    fontWeight: '700',
    fontSize: responsiveFont(15),
    marginTop: responsiveSize(14),
    textAlign: 'center',
  },
  cardMetaRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: responsiveSize(8),
    marginTop: responsiveSize(12),
    flexWrap: 'wrap',
  },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: responsiveSize(4),
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: responsiveSize(20),
    paddingVertical: responsiveSize(5),
    paddingHorizontal: responsiveSize(10),
  },
  stakeChip: { backgroundColor: 'rgba(0,210,190,0.10)' },
  teamChip: { backgroundColor: 'rgba(0,210,190,0.10)' },
  metaChipText: { color: COLORS.textSecondary, fontSize: responsiveFont(12), fontWeight: '600' },
  liveDot: { width: responsiveSize(8), height: responsiveSize(8), borderRadius: responsiveSize(4), backgroundColor: '#ef4444' },
  liveText: { color: '#ef4444', fontSize: responsiveFont(12), fontWeight: '800' },
  empty: { alignItems: 'center', paddingVertical: responsiveSize(36), gap: responsiveSize(8) },
  emptyText: { color: COLORS.textSecondary, fontSize: responsiveFont(14), fontWeight: '600' },
  emptySub: { color: COLORS.textSecondary, fontSize: responsiveFont(12), opacity: 0.7, textAlign: 'center' },
  emptyCta: { marginTop: responsiveSize(10), backgroundColor: COLORS.primary, borderRadius: responsiveSize(14), overflow: 'hidden' },
  emptyCtaInner: { paddingVertical: responsiveSize(12), paddingHorizontal: responsiveSize(18) },
  emptyCtaText: { color: '#0A0A0C', fontWeight: '800', fontSize: responsiveFont(14) },
});
