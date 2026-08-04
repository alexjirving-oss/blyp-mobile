// BattlesContent — the "Battles" sub-tab of Chat/Games.
//
// Shows any pending invites addressed to me, plus the public list of upcoming
// and live battles. A prominent "Create battle" button opens the create flow.

import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, RefreshControl } from 'react-native';
import Icon from '../Icon';
import { COLORS } from '../../styles/theme';
import { responsiveFont, responsiveSize } from '../../utils/scaleUtils';
import { useAuth } from '../../hooks/useCommon';
import {
  subscribeUpcomingBattles,
  subscribePendingInvites,
  isStaked,
  BATTLE_STATUS,
} from '../../services/battleService';

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

function Avatar({ uri, name }) {
  if (uri) return <Image source={{ uri }} style={styles.avatar} />;
  const initial = String(name || '?').charAt(0).toUpperCase();
  return (
    <View style={[styles.avatar, styles.avatarFallback]}>
      <Text style={styles.avatarInitial}>{initial}</Text>
    </View>
  );
}

function BattleCard({ battle, onPress }) {
  const live = battle.status === BATTLE_STATUS.LIVE;
  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.85} onPress={onPress}>
      <View style={styles.cardVs}>
        <View style={styles.side}>
          <Avatar uri={battle.creatorPhoto} name={battle.creatorName} />
          <Text style={styles.sideName} numberOfLines={1}>{battle.creatorName}</Text>
        </View>
        <View style={styles.vsBadge}>
          <Text style={styles.vsText}>VS</Text>
        </View>
        <View style={styles.side}>
          <Avatar uri={battle.opponentPhoto} name={battle.opponentName} />
          <Text style={styles.sideName} numberOfLines={1}>{battle.opponentName}</Text>
        </View>
      </View>

      <Text style={styles.cardTitle} numberOfLines={1}>{battle.title}</Text>

      <View style={styles.cardMetaRow}>
        {live ? (
          <View style={styles.liveBadge}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>LIVE NOW</Text>
          </View>
        ) : (
          <View style={styles.metaChip}>
            <Icon name="time-outline" size={responsiveFont(13)} color={COLORS.textSecondary} />
            <Text style={styles.metaChipText}>{startLabel(battle.scheduledStartAt)}</Text>
          </View>
        )}
        {isStaked(battle) && (
          <View style={[styles.metaChip, styles.stakeChip]}>
            <Icon name="server-outline" size={responsiveFont(13)} color={COLORS.primary} />
            <Text style={[styles.metaChipText, { color: COLORS.primary }]}>{battle.stakeCoins} coins</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

export default function BattlesContent({ navigation }) {
  const { uid } = useAuth();
  const [battles, setBattles] = useState([]);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

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

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setReloadKey((k) => k + 1);
    setTimeout(() => setRefreshing(false), 900);
  }, []);

  const openDetail = useCallback(
    (battleId) => navigation?.navigate?.('BattleDetail', { battleId }),
    [navigation]
  );

  const openCreate = useCallback(() => navigation?.navigate?.('CreateBattle'), [navigation]);

  const openRooms = useCallback(() => navigation?.navigate?.('Rooms'), [navigation]);

  const openLeaderboard = useCallback(() => navigation?.navigate?.('BattleLeaderboard'), [navigation]);

  const openDiary = useCallback(() => navigation?.navigate?.('BattleDiary'), [navigation]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
    >
      <TouchableOpacity style={styles.createButton} activeOpacity={0.9} onPress={openCreate}>
        <Icon name="flash" size={responsiveFont(18)} color="#0A0A0C" />
        <Text style={styles.createButtonText}>Create a battle</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.roomsButton} activeOpacity={0.9} onPress={openRooms}>
        <Icon name="people" size={responsiveFont(18)} color={COLORS.primary} />
        <View style={styles.roomsButtonBody}>
          <Text style={styles.roomsButtonText}>Browse video rooms</Text>
          <Text style={styles.roomsButtonSub}>Hop into a topic and grab a seat</Text>
        </View>
        <Icon name="chevron-forward" size={responsiveFont(18)} color={COLORS.textSecondary} />
      </TouchableOpacity>

      <TouchableOpacity style={styles.roomsButton} activeOpacity={0.9} onPress={openLeaderboard}>
        <Icon name="trophy" size={responsiveFont(18)} color={COLORS.primary} />
        <View style={styles.roomsButtonBody}>
          <Text style={styles.roomsButtonText}>Battle leaderboard</Text>
          <Text style={styles.roomsButtonSub}>See who's topping the glory ranks</Text>
        </View>
        <Icon name="chevron-forward" size={responsiveFont(18)} color={COLORS.textSecondary} />
      </TouchableOpacity>

      <TouchableOpacity style={styles.roomsButton} activeOpacity={0.9} onPress={openDiary}>
        <Icon name="ribbon" size={responsiveFont(18)} color={COLORS.primary} />
        <View style={styles.roomsButtonBody}>
          <Text style={styles.roomsButtonText}>Your battle diary</Text>
          <Text style={styles.roomsButtonSub}>Your history, glory and upcoming battles</Text>
        </View>
        <Icon name="chevron-forward" size={responsiveFont(18)} color={COLORS.textSecondary} />
      </TouchableOpacity>

      {invites.length > 0 && (
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

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Upcoming & live</Text>
        {loading ? (
          <Text style={styles.emptyText}>Loading battles…</Text>
        ) : battles.length === 0 ? (
          <View style={styles.empty}>
            <Icon name="flash-outline" size={responsiveFont(40)} color={COLORS.textSecondary} />
            <Text style={styles.emptyText}>No battles scheduled yet.</Text>
            <Text style={styles.emptySub}>Be the first — challenge someone to a battle.</Text>
          </View>
        ) : (
          battles.map((b) => <BattleCard key={b.id} battle={b} onPress={() => openDetail(b.id)} />)
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: responsiveSize(16), paddingBottom: responsiveSize(40) },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: responsiveSize(14),
    paddingVertical: responsiveSize(14),
    gap: responsiveSize(8),
    marginBottom: responsiveSize(20),
  },
  createButtonText: { color: '#0A0A0C', fontWeight: '800', fontSize: responsiveFont(15) },
  roomsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: responsiveSize(12),
    backgroundColor: COLORS.backgroundCard,
    borderRadius: responsiveSize(14),
    padding: responsiveSize(14),
    marginBottom: responsiveSize(20),
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.25)',
  },
  roomsButtonBody: { flex: 1 },
  roomsButtonText: { color: COLORS.textPrimary, fontWeight: '700', fontSize: responsiveFont(14) },
  roomsButtonSub: { color: COLORS.textSecondary, fontSize: responsiveFont(12), marginTop: 2 },
  section: { marginBottom: responsiveSize(22) },
  sectionTitle: {
    color: COLORS.textPrimary,
    fontWeight: '700',
    fontSize: responsiveFont(14),
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
    padding: responsiveSize(16),
    marginBottom: responsiveSize(12),
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  cardVs: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  side: { alignItems: 'center', flex: 1 },
  sideName: { color: COLORS.textPrimary, fontSize: responsiveFont(13), fontWeight: '600', marginTop: responsiveSize(6), maxWidth: responsiveSize(110) },
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
  cardTitle: { color: COLORS.textPrimary, fontWeight: '700', fontSize: responsiveFont(15), marginTop: responsiveSize(14), textAlign: 'center' },
  cardMetaRow: { flexDirection: 'row', justifyContent: 'center', gap: responsiveSize(8), marginTop: responsiveSize(12), flexWrap: 'wrap' },
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
  metaChipText: { color: COLORS.textSecondary, fontSize: responsiveFont(12), fontWeight: '600' },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: responsiveSize(6),
    backgroundColor: 'rgba(239,68,68,0.15)',
    borderRadius: responsiveSize(20),
    paddingVertical: responsiveSize(5),
    paddingHorizontal: responsiveSize(10),
  },
  liveDot: { width: responsiveSize(8), height: responsiveSize(8), borderRadius: responsiveSize(4), backgroundColor: '#ef4444' },
  liveText: { color: '#ef4444', fontSize: responsiveFont(12), fontWeight: '800' },
  empty: { alignItems: 'center', paddingVertical: responsiveSize(40), gap: responsiveSize(8) },
  emptyText: { color: COLORS.textSecondary, fontSize: responsiveFont(14), fontWeight: '600' },
  emptySub: { color: COLORS.textSecondary, fontSize: responsiveFont(12), opacity: 0.7 },
});
