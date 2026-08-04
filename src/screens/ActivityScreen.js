// ActivityScreen.js
//
// The activity / notifications center. Aggregates new followers, comments and
// likes on the user's posts (via activityService) into one time-sorted feed.
// Marks activity as "seen" on open so the Home badge clears.

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import Icon from '../components/Icon';
import { COLORS } from '../styles/theme';
import { responsiveFont, responsiveSize } from '../utils/scaleUtils';
import { useAuth } from '../hooks/useCommon';
import { getActivity } from '../services/activityService';
import { setActivitySeen } from '../services/userPreferencesService';

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return `${Math.floor(d / 7)}w`;
}

const ICON = {
  follow: { name: 'person-add', color: '#00D2BE' },
  comment: { name: 'chatbubble', color: '#4DA3FF' },
  like: { name: 'heart', color: '#FF3B30' },
};

const ActivityScreen = ({ navigation }) => {
  const { uid } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const res = await getActivity(uid);
    setItems(res);
    setLoading(false);
    setRefreshing(false);
  }, [uid]);

  useEffect(() => {
    setLoading(true);
    load();
    // Mark as seen so the Home bell badge clears.
    setActivitySeen(uid);
  }, [load, uid]);

  const openItem = (item) => {
    if (item.type === 'follow') {
      navigation.navigate('UserProfile', { userId: item.actorId, username: item.username });
    } else if (item.post) {
      navigation.navigate('MediaViewer', { post: item.post });
    }
  };

  const label = (item) => {
    if (item.type === 'follow') return ' started following you';
    if (item.type === 'comment') return ` commented: ${item.text || ''}`;
    return ' liked your post';
  };

  const renderItem = ({ item }) => {
    const initial = (item.username || '?').slice(0, 1).toUpperCase();
    const badge = ICON[item.type] || ICON.like;
    return (
      <TouchableOpacity style={styles.row} activeOpacity={0.85} onPress={() => openItem(item)}>
        <View style={styles.avatarWrap}>
          {item.avatar ? (
            <Image source={{ uri: item.avatar }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Text style={styles.avatarInitial}>{initial}</Text>
            </View>
          )}
          <View style={[styles.badge, { backgroundColor: badge.color }]}>
            <Icon name={badge.name} size={11} color="#fff" />
          </View>
        </View>

        <View style={styles.rowBody}>
          <Text style={styles.rowText} numberOfLines={2}>
            <Text style={styles.username}>@{item.username}</Text>
            {label(item)}
          </Text>
          <Text style={styles.time}>{timeAgo(item.ts)}</Text>
        </View>

        {item.thumbnail ? (
          <Image source={{ uri: item.thumbnail }} style={styles.thumb} />
        ) : item.type === 'follow' ? (
          <View style={styles.followPill}>
            <Text style={styles.followPillText}>View</Text>
          </View>
        ) : null}
      </TouchableOpacity>
    );
  };

  return (
    <ScreenContainer>
      <View style={styles.container}>
        <View style={styles.topRow}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Icon name="chevron-back" size={24} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>Activity</Text>
          <View style={styles.backBtn} />
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={COLORS.primary} />
          </View>
        ) : (
          <FlatList
            data={items}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={COLORS.primary} />
            }
            ListEmptyComponent={
              <View style={styles.center}>
                <Icon name="notifications-outline" size={44} color={COLORS.textMuted} />
                <Text style={styles.emptyText}>No activity yet</Text>
                <Text style={styles.emptySub}>Follows, comments and likes on your posts will show up here.</Text>
              </View>
            }
          />
        )}
      </View>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: responsiveSize(8) },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, marginBottom: 8 },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { color: COLORS.textPrimary, fontSize: responsiveFont(18), fontWeight: '800' },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: responsiveSize(80), paddingHorizontal: 40, gap: 8 },
  emptyText: { color: COLORS.textPrimary, fontSize: responsiveFont(16), fontWeight: '700' },
  emptySub: { color: COLORS.textMuted, fontSize: responsiveFont(13), textAlign: 'center', lineHeight: responsiveFont(19) },

  list: { paddingHorizontal: 14, paddingBottom: 120 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  avatarWrap: { width: 50, height: 50 },
  avatar: { width: 50, height: 50, borderRadius: 25, backgroundColor: COLORS.surface },
  avatarFallback: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border },
  avatarInitial: { color: COLORS.textPrimary, fontSize: responsiveFont(18), fontWeight: '800' },
  badge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.pageBackground,
  },
  rowBody: { flex: 1 },
  rowText: { color: COLORS.textPrimary, fontSize: responsiveFont(14), lineHeight: responsiveFont(19) },
  username: { fontWeight: '800' },
  time: { color: COLORS.textMuted, fontSize: responsiveFont(12), marginTop: 3 },
  thumb: { width: 46, height: 46, borderRadius: 8, backgroundColor: COLORS.surface },
  followPill: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, backgroundColor: COLORS.primary },
  followPillText: { color: COLORS.black, fontSize: responsiveFont(12), fontWeight: '800' },
});

export default ActivityScreen;
