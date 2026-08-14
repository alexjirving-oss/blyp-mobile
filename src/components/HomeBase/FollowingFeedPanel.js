// FollowingFeedPanel.js
//
// Home "Following" page: people from the real follow graph + recent posts from
// each follow (per-author queries). Empty posts still show the people strip so
// the page matches Profile Following count/list.

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
import Icon from '../Icon';
import { COLORS } from '../../styles/theme';
import { responsiveFont, responsiveSize } from '../../utils/scaleUtils';
import { getFollowingPosts } from '../../services/discoveryService';
import { postThumbnail } from '../../services/blypAiService';
import { getFollowingIds, subscribeToFollowingList } from '../../utils/followUtils';
import { mediaViewerParams } from '../../utils/mediaViewerPlaylist';
import { prefetchPostWindow, prefetchUriList, runWhenIdle } from '../../utils/mediaPrefetch';
import { db, firebaseEnabled } from '../../config/firebase';

async function loadFollowedPeople(ids) {
  const unique = [...new Set((ids || []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!unique.length || !firebaseEnabled || !db?.collection) {
    return unique.map((id) => ({ id, username: id.slice(0, 8) }));
  }
  const out = [];
  for (let i = 0; i < unique.length; i += 30) {
    const chunk = unique.slice(i, i + 30);
    const snaps = await Promise.all(
      chunk.map(async (id) => {
        try {
          const snap = await db.collection('users').doc(id).get();
          const data = snap?.exists
            ? (typeof snap.data === 'function' ? snap.data() : snap.data) || {}
            : {};
          return {
            id,
            username: data.username || data.displayName || data.name || id.slice(0, 8),
            photoURL: data.photoURL || data.avatarUrl || data.avatar || null,
          };
        } catch {
          return { id, username: id.slice(0, 8), photoURL: null };
        }
      }),
    );
    out.push(...snaps);
  }
  return out;
}

const FollowingFeedPanel = ({ navigation, uid }) => {
  const [following, setFollowing] = useState(new Set());
  const [people, setPeople] = useState([]);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!uid) {
      setLoading(false);
      return undefined;
    }
    const unsub = subscribeToFollowingList(uid, setFollowing);
    return unsub;
  }, [uid]);

  const followingKey = useMemo(
    () => Array.from(following || []).sort().join(','),
    [following],
  );

  const load = useCallback(async () => {
    let ids = Array.from(following || []);
    // Snapshot can lag; one-shot read matches Profile Following count source.
    if ((!ids.length || ids.length < 2) && uid) {
      try {
        const fresh = await getFollowingIds(uid);
        if (fresh?.length) ids = fresh;
      } catch { /* keep snapshot ids */ }
    }
    const [nextPeople, nextPosts] = await Promise.all([
      loadFollowedPeople(ids),
      getFollowingPosts(ids, 60),
    ]);
    setPeople(nextPeople);
    setPosts(nextPosts);
    setLoading(false);
    setRefreshing(false);
    runWhenIdle(() => {
      prefetchPostWindow(nextPosts, 0, { radius: 2, images: true });
      prefetchUriList(
        [
          ...nextPeople.map((p) => p.photoURL),
          ...(nextPosts || []).flatMap((p) => [postThumbnail(p), p.userPhotoURL, p.user?.avatar]),
        ],
        { idle: false },
      );
    });
  }, [following, uid]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load, followingKey]);

  const openPost = (post) => navigation.navigate('MediaViewer', mediaViewerParams(post, posts));
  const openProfile = (person) => {
    if (!person?.id) return;
    navigation.navigate('UserProfile', { userId: person.id });
  };

  const listHeader = (
    <View>
      {people.length > 0 ? (
        <View style={styles.peopleBlock}>
          <Text style={styles.peopleTitle}>People you follow · {people.length}</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.peopleRow}
          >
            {people.map((person) => (
              <TouchableOpacity
                key={person.id}
                style={styles.personChip}
                activeOpacity={0.85}
                onPress={() => openProfile(person)}
              >
                {person.photoURL ? (
                  <Image source={{ uri: person.photoURL }} style={styles.personAvatar} />
                ) : (
                  <View style={[styles.personAvatar, styles.personAvatarFallback]}>
                    <Icon name="person" size={18} color={COLORS.textMuted} />
                  </View>
                )}
                <Text style={styles.personName} numberOfLines={1}>
                  @{person.username}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      ) : null}
      {posts.length > 0 ? (
        <Text style={styles.postsTitle}>Recent from follows</Text>
      ) : null}
    </View>
  );

  const renderItem = ({ item }) => {
    const uri = postThumbnail(item);
    const isVideo = item.type === 'video' || !!item.videoUrl;
    return (
      <TouchableOpacity style={styles.card} activeOpacity={0.85} onPress={() => openPost(item)}>
        <View style={styles.thumbWrap}>
          {uri ? (
            <Image source={{ uri }} style={styles.thumb} resizeMode="cover" />
          ) : (
            <View style={[styles.thumb, styles.thumbFallback]}>
              <Icon name="image-outline" size={24} color={COLORS.textMuted} />
            </View>
          )}
          {isVideo && (
            <View style={styles.playBadge}>
              <Icon name="play" size={13} color={COLORS.white} />
            </View>
          )}
        </View>
        <Text style={styles.cardTitle} numberOfLines={1}>
          @{item.username || item.userDisplayName || 'user'}
        </Text>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  const empty = people.length === 0 && posts.length === 0;

  return (
    <FlatList
      style={styles.root}
      data={posts}
      keyExtractor={(item) => String(item.id)}
      renderItem={renderItem}
      numColumns={2}
      columnWrapperStyle={posts.length ? styles.row : undefined}
      ListHeaderComponent={listHeader}
      contentContainerStyle={styles.grid}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={COLORS.primary} />
      }
      ListEmptyComponent={
        empty ? (
          <View style={styles.center}>
            <Icon name="people-outline" size={44} color={COLORS.textMuted} />
            <Text style={styles.emptyText}>You&apos;re not following anyone yet</Text>
            <Text style={styles.emptySub}>Find creators to fill this feed.</Text>
            <TouchableOpacity style={styles.findBtn} activeOpacity={0.85} onPress={() => navigation.navigate('FindPeople')}>
              <Icon name="person-add" size={16} color={COLORS.black} />
              <Text style={styles.findBtnText}>Find people</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.emptyPosts}>
            <Text style={styles.emptySub}>No recent posts from your follows yet.</Text>
          </View>
        )
      }
    />
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.pageBackground },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: responsiveSize(80), paddingHorizontal: 40, gap: 8 },
  grid: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 120 },
  row: { justifyContent: 'space-between' },
  peopleBlock: { marginBottom: 14 },
  peopleTitle: {
    color: COLORS.textPrimary,
    fontSize: responsiveFont(15),
    fontWeight: '700',
    marginBottom: 10,
  },
  peopleRow: { gap: 12, paddingRight: 8 },
  personChip: { width: responsiveSize(72), alignItems: 'center' },
  personAvatar: {
    width: responsiveSize(56),
    height: responsiveSize(56),
    borderRadius: responsiveSize(28),
    backgroundColor: COLORS.surface,
  },
  personAvatarFallback: { alignItems: 'center', justifyContent: 'center' },
  personName: {
    color: COLORS.textSecondary,
    fontSize: responsiveFont(11),
    marginTop: 6,
    textAlign: 'center',
    width: '100%',
  },
  postsTitle: {
    color: COLORS.textPrimary,
    fontSize: responsiveFont(15),
    fontWeight: '700',
    marginBottom: 10,
  },
  card: { width: '48%', marginBottom: 16 },
  thumbWrap: { position: 'relative', width: '100%', aspectRatio: 1, borderRadius: 12, overflow: 'hidden' },
  thumb: { width: '100%', height: '100%', backgroundColor: COLORS.surface },
  thumbFallback: { alignItems: 'center', justifyContent: 'center' },
  playBadge: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { color: COLORS.textSecondary, fontSize: responsiveFont(13), marginTop: 6 },
  emptyText: { color: COLORS.textPrimary, fontSize: responsiveFont(15), fontWeight: '700', textAlign: 'center', marginTop: 6 },
  emptySub: { color: COLORS.textMuted, fontSize: responsiveFont(13), textAlign: 'center' },
  emptyPosts: { paddingVertical: 24, alignItems: 'center' },
  findBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: COLORS.primary,
  },
  findBtnText: { color: COLORS.black, fontSize: responsiveFont(14), fontWeight: '800' },
});

export default FollowingFeedPanel;
