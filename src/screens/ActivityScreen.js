// ActivityScreen.js
//
// The activity / notifications center. Aggregates new followers, comments and
// likes on the user's posts (via activityService) into one time-sorted feed.
// Actors render as Top Circle–style circular photo avatars (real photoURL).
// Marks activity as "seen" on open so the Home badge clears.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  RefreshControl,
  ScrollView,
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
import { getActivity, pickCircleStripActors } from '../services/activityService';
import { setActivitySeen } from '../services/userPreferencesService';
import { looksLikeRawId, pickPublicLabel } from '../utils/publicLabel';

function actorLabel(item) {
  const label = pickPublicLabel(
    {
      username: item?.username,
      displayName: item?.displayName,
      actorUsername: item?.actorUsername,
      actorDisplayName: item?.actorDisplayName,
    },
    { uid: item?.actorId, fallback: 'Someone' }
  );
  return looksLikeRawId(label) ? 'Someone' : label;
}

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

function activityCopy(item) {
  const kind = item.postKind === 'video' ? 'video' : 'post';
  if (item.type === 'follow') return ' started following you';
  if (item.type === 'comment') {
    const text = String(item.text || '').trim();
    return text ? ` commented: ${text}` : ` commented on your ${kind}`;
  }
  return ` liked your ${kind}`;
}

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

  // Prefer Top Circle actors; if Top Circle is empty, fall back to following
  // so "From your Circle" is not a dead empty strip.
  const circleActors = useMemo(() => {
    return pickCircleStripActors(items, { limit: 8 }).map((item) => ({
      actorId: item.actorId,
      username: actorLabel(item),
      avatar: item.avatar || null,
    }));
  }, [items]);

  const openProfile = (actorId, name) => {
    if (!actorId) return;
    navigation.navigate('UserProfile', { userId: actorId, username: name });
  };

  const openItem = (item) => {
    const name = actorLabel(item);
    if (item.type === 'follow') {
      openProfile(item.actorId, name);
    } else if (item.post) {
      navigation.navigate('MediaViewer', { post: item.post });
    } else {
      openProfile(item.actorId, name);
    }
  };

  const renderCircleStrip = () => {
    if (!circleActors.length) return null;
    return (
      <View style={styles.circleSection}>
        <Text style={styles.circleEyebrow}>From your Circle</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.circleRow}
        >
          {circleActors.map((p) => {
            const initial = (p.username || '?').slice(0, 1).toUpperCase();
            return (
              <TouchableOpacity
                key={p.actorId}
                style={styles.circleItem}
                activeOpacity={0.85}
                onPress={() => openProfile(p.actorId, p.username)}
              >
                {p.avatar ? (
                  <Image
                    source={{ uri: p.avatar }}
                    style={[styles.circleAvatar, { borderColor: COLORS.primary }]}
                  />
                ) : (
                  <View
                    style={[
                      styles.circleAvatar,
                      styles.circleAvatarFallback,
                      { borderColor: COLORS.border },
                    ]}
                  >
                    <Text style={styles.circleInitial}>{initial}</Text>
                  </View>
                )}
                <Text style={styles.circleName} numberOfLines={1}>
                  {p.username}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    );
  };

  const renderItem = ({ item }) => {
    const name = actorLabel(item);
    const initial = (name || '?').slice(0, 1).toUpperCase();
    const badge = ICON[item.type] || ICON.like;
    const ringColor = item.inTopCircle ? COLORS.primary : COLORS.border;
    return (
      <View style={styles.row}>
        <TouchableOpacity
          style={styles.avatarWrap}
          activeOpacity={0.85}
          onPress={() => openProfile(item.actorId, name)}
          accessibilityRole="button"
          accessibilityLabel={`Open @${name}`}
        >
          {item.avatar ? (
            <Image source={{ uri: item.avatar }} style={[styles.avatar, { borderColor: ringColor }]} />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback, { borderColor: ringColor }]}>
              <Text style={styles.avatarInitial}>{initial}</Text>
            </View>
          )}
          <View style={[styles.badge, { backgroundColor: badge.color }]}>
            <Icon name={badge.name} size={11} color="#fff" />
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={styles.rowBody} activeOpacity={0.85} onPress={() => openItem(item)}>
          <Text style={styles.rowText} numberOfLines={2}>
            <Text style={styles.username}>@{name}</Text>
            {activityCopy(item)}
          </Text>
          <View style={styles.metaRow}>
            <Text style={styles.time}>{timeAgo(item.ts)}</Text>
            {item.inTopCircle ? (
              <Text style={styles.circleTag}>Circle</Text>
            ) : item.inFollowing ? (
              <Text style={styles.followingTag}>Following</Text>
            ) : null}
          </View>
        </TouchableOpacity>

        {item.thumbnail ? (
          <TouchableOpacity activeOpacity={0.85} onPress={() => openItem(item)}>
            <Image source={{ uri: item.thumbnail }} style={styles.thumb} />
          </TouchableOpacity>
        ) : item.type === 'follow' ? (
          <TouchableOpacity style={styles.followPill} activeOpacity={0.85} onPress={() => openProfile(item.actorId, name)}>
            <Text style={styles.followPillText}>View</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  };

  return (
    <ScreenContainer>
      <View style={styles.container}>
        <View style={styles.topRow}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
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
            ListHeaderComponent={renderCircleStrip}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => {
                  setRefreshing(true);
                  load();
                }}
                tintColor={COLORS.primary}
              />
            }
            ListEmptyComponent={
              <View style={styles.center}>
                <Icon name="notifications-outline" size={44} color={COLORS.textMuted} />
                <Text style={styles.emptyText}>No activity yet</Text>
                <Text style={styles.emptySub}>
                  When people in your Circle or on Blyp follow, like, or comment, it shows up here.
                </Text>
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
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { color: COLORS.textPrimary, fontSize: responsiveFont(18), fontWeight: '800' },

  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: responsiveSize(80),
    paddingHorizontal: 40,
    gap: 8,
  },
  emptyText: { color: COLORS.textPrimary, fontSize: responsiveFont(16), fontWeight: '700' },
  emptySub: {
    color: COLORS.textMuted,
    fontSize: responsiveFont(13),
    textAlign: 'center',
    lineHeight: responsiveFont(19),
  },

  circleSection: { marginBottom: 10, paddingTop: 4 },
  circleEyebrow: {
    color: COLORS.primary,
    fontSize: responsiveFont(12),
    fontWeight: '700',
    marginBottom: 10,
    letterSpacing: 0.3,
  },
  circleRow: { gap: 14, paddingRight: 8 },
  circleItem: { width: 72, alignItems: 'center' },
  circleAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    backgroundColor: COLORS.surface,
  },
  circleAvatarFallback: { alignItems: 'center', justifyContent: 'center' },
  circleInitial: { color: COLORS.textPrimary, fontSize: responsiveFont(18), fontWeight: '800' },
  circleName: {
    marginTop: 6,
    fontSize: responsiveFont(11),
    fontWeight: '600',
    color: COLORS.textPrimary,
    textAlign: 'center',
    width: '100%',
  },

  list: { paddingHorizontal: 14, paddingBottom: 120 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  avatarWrap: { width: 50, height: 50 },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 2,
    backgroundColor: COLORS.surface,
  },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
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
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3 },
  time: { color: COLORS.textMuted, fontSize: responsiveFont(12) },
  circleTag: {
    color: COLORS.primary,
    fontSize: responsiveFont(11),
    fontWeight: '700',
  },
  followingTag: {
    color: COLORS.textMuted,
    fontSize: responsiveFont(11),
    fontWeight: '600',
  },
  thumb: { width: 46, height: 46, borderRadius: 8, backgroundColor: COLORS.surface },
  followPill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: COLORS.primary,
  },
  followPillText: { color: COLORS.black, fontSize: responsiveFont(12), fontWeight: '800' },
});

export default ActivityScreen;
