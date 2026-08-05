// RoomsScreen — browse hostless, topic-based group video rooms.
//
// Rooms are grouped by topic (reusing the app's interest catalogue). Each card
// shows live occupancy (X / capacity). Occupied rooms float first. Tapping a
// room opens RoomScreen; empty rooms surface a page-ambassador CTA.

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  SafeAreaView,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import Icon from '../components/Icon';
import { COLORS } from '../styles/theme';
import { responsiveFont, responsiveSize } from '../utils/scaleUtils';
import { useAuth } from '../hooks/useCommon';
import {
  fetchRooms,
  subscribeRooms,
  groupRoomsByTopic,
  filterRoomsByQuery,
  claimRoomAmbassador,
  isRoomAmbassador,
} from '../services/roomsService';
import { shareRoom } from '../services/shareService';

function OccupancyBadge({ room }) {
  if (room.isFull) {
    return (
      <View style={[styles.badge, styles.fullBadge]}>
        <Icon name="people" size={responsiveFont(12)} color="#ef4444" />
        <Text style={[styles.badgeText, { color: '#ef4444' }]}>Full</Text>
      </View>
    );
  }
  const live = room.publisherCount > 0;
  return (
    <View style={[styles.badge, live ? styles.liveBadge : styles.openBadge]}>
      {live ? <View style={styles.liveDot} /> : <Icon name="add-circle-outline" size={responsiveFont(12)} color={COLORS.primary} />}
      <Text style={[styles.badgeText, { color: live ? '#22c55e' : COLORS.primary }]}>
        {live ? `${room.publisherCount} live` : 'Open seats'}
      </Text>
    </View>
  );
}

function AmbassadorBadge() {
  return (
    <View style={[styles.badge, styles.ambassadorBadge]}>
      <Icon name="ribbon-outline" size={responsiveFont(11)} color="#f59e0b" />
      <Text style={[styles.badgeText, { color: '#f59e0b' }]}>Ambassador</Text>
    </View>
  );
}

function RoomCard({ room, onPress, onAmbassador, claiming, isAmbassador }) {
  const empty = (room.publisherCount || 0) === 0;
  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.85} onPress={onPress}>
      <View style={styles.cardLeft}>
        <View style={styles.titleRow}>
          <Text style={styles.cardTitle} numberOfLines={1}>{room.title}</Text>
          {(room.ambassadorCount > 0 || (room.ambassadors || []).length > 0) ? (
            <AmbassadorBadge />
          ) : null}
        </View>
        <Text style={styles.cardSub} numberOfLines={1}>{room.topicLabel}</Text>
        {empty ? (
          <TouchableOpacity
            style={styles.ambassadorCta}
            onPress={(e) => {
              e?.stopPropagation?.();
              onAmbassador?.(room);
            }}
            disabled={claiming || isAmbassador}
            hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
          >
            {claiming ? (
              <ActivityIndicator size="small" color={COLORS.primary} />
            ) : (
              <Text style={styles.ambassadorCtaText}>
                {isAmbassador
                  ? 'You’re a page ambassador · tap to open'
                  : 'Would you like to become a page ambassador?'}
              </Text>
            )}
          </TouchableOpacity>
        ) : null}
      </View>
      <View style={styles.cardRight}>
        <OccupancyBadge room={room} />
        <Text style={styles.capacityText}>{room.publisherCount}/{room.capacity}</Text>
      </View>
    </TouchableOpacity>
  );
}

export default function RoomsScreen({ navigation }) {
  const { uid, user } = useAuth();
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [claimingId, setClaimingId] = useState(null);

  const loadOnce = useCallback(async () => {
    const list = await fetchRooms();
    if (list && list.length) setRooms(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadOnce();
  }, [loadOnce]);

  // Realtime occupancy once rooms exist in Firestore.
  useEffect(() => {
    const unsub = subscribeRooms((rows) => {
      if (rows && rows.length) {
        setRooms(rows);
        setLoading(false);
      }
    });
    return () => { try { unsub && unsub(); } catch {} };
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadOnce();
    setRefreshing(false);
  }, [loadOnce]);

  const filtered = useMemo(
    () => filterRoomsByQuery(rooms, searchQuery),
    [rooms, searchQuery],
  );

  const sections = useMemo(() => groupRoomsByTopic(filtered), [filtered]);

  const openRoom = useCallback(
    (room) => navigation?.navigate?.('Room', { roomId: room.roomId, title: room.title, topicLabel: room.topicLabel }),
    [navigation]
  );

  const onAmbassador = useCallback(async (room) => {
    if (!uid) {
      Alert.alert('Sign in required', 'Sign in to become a page ambassador.');
      return;
    }
    if (isRoomAmbassador(room, uid)) {
      openRoom(room);
      return;
    }
    Alert.alert(
      'Become a page ambassador?',
      `Help grow “${room.title}” — welcome people, share the room link, and optionally pin a short intro. No CMS required.`,
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Yes, I’m in',
          onPress: async () => {
            setClaimingId(room.roomId);
            try {
              const displayName = user?.displayName || user?.username || undefined;
              await claimRoomAmbassador(room.roomId, displayName);
              await shareRoom({
                roomId: room.roomId,
                title: room.title,
                topicLabel: room.topicLabel,
              });
              Alert.alert(
                'You’re a page ambassador',
                'Share the room anytime from inside. Tap the room to join and welcome people.',
                [{ text: 'Open room', onPress: () => openRoom(room) }],
              );
            } catch (e) {
              const code = e?.code || '';
              const msg =
                code === 'AMBASSADOR_FULL'
                  ? 'This room already has enough ambassadors.'
                  : (e?.message || 'Could not claim ambassador role.');
              Alert.alert('Couldn’t claim', msg);
            } finally {
              setClaimingId(null);
            }
          },
        },
      ],
    );
  }, [uid, user, openRoom]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation?.goBack?.()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Icon name="chevron-back" size={responsiveFont(24)} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Rooms</Text>
        <View style={{ width: responsiveSize(24) }} />
      </View>

      <View style={styles.searchWrap}>
        <Icon name="search" size={responsiveFont(16)} color={COLORS.textSecondary} />
        <TextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search rooms…"
          placeholderTextColor={COLORS.textSecondary}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
        />
        {!!searchQuery && (
          <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Icon name="close-circle" size={responsiveFont(16)} color={COLORS.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
      >
        <Text style={styles.intro}>Drop into a topic. Rooms with people show first — grab a seat or become a page ambassador for an empty room.</Text>

        {loading ? (
          <Text style={styles.emptyText}>Loading rooms…</Text>
        ) : sections.length === 0 ? (
          <View style={styles.empty}>
            <Icon name="videocam-outline" size={responsiveFont(40)} color={COLORS.textSecondary} />
            <Text style={styles.emptyText}>
              {searchQuery.trim() ? 'No rooms match your search.' : 'No rooms available yet.'}
            </Text>
          </View>
        ) : (
          sections.map((section) => (
            <View key={section.topicId} style={styles.section}>
              <View style={styles.sectionHeader}>
                <Icon name={section.icon} size={responsiveFont(16)} color={COLORS.primary} />
                <Text style={styles.sectionTitle}>{section.topicLabel}</Text>
              </View>
              {section.rooms.map((room) => (
                <RoomCard
                  key={room.roomId}
                  room={room}
                  onPress={() => openRoom(room)}
                  onAmbassador={onAmbassador}
                  claiming={claimingId === room.roomId}
                  isAmbassador={isRoomAmbassador(room, uid)}
                />
              ))}
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: responsiveSize(16),
    paddingVertical: responsiveSize(12),
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: { color: COLORS.textPrimary, fontWeight: '800', fontSize: responsiveFont(18) },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: responsiveSize(8),
    marginHorizontal: responsiveSize(16),
    marginTop: responsiveSize(12),
    paddingHorizontal: responsiveSize(12),
    paddingVertical: responsiveSize(10),
    borderRadius: responsiveSize(12),
    backgroundColor: COLORS.backgroundCard,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  searchInput: {
    flex: 1,
    color: COLORS.textPrimary,
    fontSize: responsiveFont(14),
    padding: 0,
  },
  container: { flex: 1 },
  content: { padding: responsiveSize(16), paddingBottom: responsiveSize(40) },
  intro: { color: COLORS.textSecondary, fontSize: responsiveFont(13), marginBottom: responsiveSize(18), lineHeight: responsiveFont(18) },
  section: { marginBottom: responsiveSize(22) },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: responsiveSize(8), marginBottom: responsiveSize(10) },
  sectionTitle: {
    color: COLORS.textPrimary,
    fontWeight: '700',
    fontSize: responsiveFont(14),
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.backgroundCard,
    borderRadius: responsiveSize(14),
    padding: responsiveSize(16),
    marginBottom: responsiveSize(10),
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cardLeft: { flex: 1, paddingRight: responsiveSize(12) },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: responsiveSize(6), flexWrap: 'wrap' },
  cardTitle: { color: COLORS.textPrimary, fontWeight: '700', fontSize: responsiveFont(15), flexShrink: 1 },
  cardSub: { color: COLORS.textSecondary, fontSize: responsiveFont(12), marginTop: responsiveSize(3) },
  ambassadorCta: { marginTop: responsiveSize(8) },
  ambassadorCtaText: {
    color: COLORS.primary,
    fontSize: responsiveFont(12),
    fontWeight: '600',
    lineHeight: responsiveFont(16),
  },
  cardRight: { alignItems: 'flex-end', gap: responsiveSize(6) },
  capacityText: { color: COLORS.textSecondary, fontSize: responsiveFont(12), fontWeight: '600' },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: responsiveSize(4),
    borderRadius: responsiveSize(20),
    paddingVertical: responsiveSize(4),
    paddingHorizontal: responsiveSize(9),
  },
  openBadge: { backgroundColor: 'rgba(0,210,190,0.10)' },
  liveBadge: { backgroundColor: 'rgba(34,197,94,0.12)' },
  fullBadge: { backgroundColor: 'rgba(239,68,68,0.12)' },
  ambassadorBadge: { backgroundColor: 'rgba(245,158,11,0.12)' },
  badgeText: { fontSize: responsiveFont(11), fontWeight: '700' },
  liveDot: { width: responsiveSize(7), height: responsiveSize(7), borderRadius: responsiveSize(4), backgroundColor: '#22c55e' },
  empty: { alignItems: 'center', paddingVertical: responsiveSize(40), gap: responsiveSize(8) },
  emptyText: { color: COLORS.textSecondary, fontSize: responsiveFont(14), fontWeight: '600' },
});
