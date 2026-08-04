// RoomsScreen — browse hostless, topic-based group video rooms.
//
// Rooms are grouped by topic (reusing the app's interest catalogue). Each card
// shows live occupancy (X / capacity). Tapping a room opens RoomScreen where the
// user can claim an open seat and publish, or just watch.

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  SafeAreaView,
} from 'react-native';
import Icon from '../components/Icon';
import { COLORS } from '../styles/theme';
import { responsiveFont, responsiveSize } from '../utils/scaleUtils';
import {
  fetchRooms,
  subscribeRooms,
  groupRoomsByTopic,
} from '../services/roomsService';

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

function RoomCard({ room, onPress }) {
  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.85} onPress={onPress}>
      <View style={styles.cardLeft}>
        <Text style={styles.cardTitle} numberOfLines={1}>{room.title}</Text>
        <Text style={styles.cardSub} numberOfLines={1}>{room.topicLabel}</Text>
      </View>
      <View style={styles.cardRight}>
        <OccupancyBadge room={room} />
        <Text style={styles.capacityText}>{room.publisherCount}/{room.capacity}</Text>
      </View>
    </TouchableOpacity>
  );
}

export default function RoomsScreen({ navigation }) {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

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

  const sections = useMemo(() => groupRoomsByTopic(rooms), [rooms]);

  const openRoom = useCallback(
    (room) => navigation?.navigate?.('Room', { roomId: room.roomId, title: room.title, topicLabel: room.topicLabel }),
    [navigation]
  );

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation?.goBack?.()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Icon name="chevron-back" size={responsiveFont(24)} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Rooms</Text>
        <View style={{ width: responsiveSize(24) }} />
      </View>

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
      >
        <Text style={styles.intro}>Drop into a topic. Grab an open seat to join the chat, or just watch.</Text>

        {loading ? (
          <Text style={styles.emptyText}>Loading rooms…</Text>
        ) : sections.length === 0 ? (
          <View style={styles.empty}>
            <Icon name="videocam-outline" size={responsiveFont(40)} color={COLORS.textSecondary} />
            <Text style={styles.emptyText}>No rooms available yet.</Text>
          </View>
        ) : (
          sections.map((section) => (
            <View key={section.topicId} style={styles.section}>
              <View style={styles.sectionHeader}>
                <Icon name={section.icon} size={responsiveFont(16)} color={COLORS.primary} />
                <Text style={styles.sectionTitle}>{section.topicLabel}</Text>
              </View>
              {section.rooms.map((room) => (
                <RoomCard key={room.roomId} room={room} onPress={() => openRoom(room)} />
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
  cardTitle: { color: COLORS.textPrimary, fontWeight: '700', fontSize: responsiveFont(15) },
  cardSub: { color: COLORS.textSecondary, fontSize: responsiveFont(12), marginTop: responsiveSize(3) },
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
  badgeText: { fontSize: responsiveFont(11), fontWeight: '700' },
  liveDot: { width: responsiveSize(7), height: responsiveSize(7), borderRadius: responsiveSize(4), backgroundColor: '#22c55e' },
  empty: { alignItems: 'center', paddingVertical: responsiveSize(40), gap: responsiveSize(8) },
  emptyText: { color: COLORS.textSecondary, fontSize: responsiveFont(14), fontWeight: '600' },
});
