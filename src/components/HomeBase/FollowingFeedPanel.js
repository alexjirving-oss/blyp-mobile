// FollowingFeedPanel.js
//
// A real feed of recent posts from the people the user follows. Used by
// HomeScreen for the "Following" page. Empty state nudges discovery.

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
import Icon from '../Icon';
import { COLORS } from '../../styles/theme';
import { responsiveFont, responsiveSize } from '../../utils/scaleUtils';
import { getFollowingPosts } from '../../services/discoveryService';
import { postThumbnail } from '../../services/blypAiService';
import { subscribeToFollowingList } from '../../utils/followUtils';
import { mediaViewerParams, isVideoPost } from '../../utils/mediaViewerPlaylist';
import { prefetchVideoToCache } from '../../utils/videoCache';
import { fixStorageUrl } from '../../utils/urlUtils';

const FollowingFeedPanel = ({ navigation, uid }) => {
  const [following, setFollowing] = useState(new Set());
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

  const load = useCallback(async () => {
    const ids = Array.from(following);
    const res = await getFollowingPosts(ids, 40);
    setPosts(res);
    setLoading(false);
    setRefreshing(false);
    // Light warmup: first few video URIs so MediaViewer opens warm.
    (res || [])
      .filter((p) => isVideoPost(p))
      .slice(0, 3)
      .forEach((p) => {
        const uri = fixStorageUrl(p.videoUrl || p.mediaUrl || p?.media?.[0]?.url);
        if (uri) prefetchVideoToCache(uri).catch(() => {});
      });
  }, [following]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const openPost = (post) => navigation.navigate('MediaViewer', mediaViewerParams(post, posts));

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

  return (
    <FlatList
      style={styles.root}
      data={posts}
      keyExtractor={(item) => String(item.id)}
      renderItem={renderItem}
      numColumns={2}
      columnWrapperStyle={styles.row}
      contentContainerStyle={styles.grid}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={COLORS.primary} />
      }
      ListEmptyComponent={
        <View style={styles.center}>
          <Icon name="people-outline" size={44} color={COLORS.textMuted} />
          <Text style={styles.emptyText}>
            {following.size === 0 ? 'You\u2019re not following anyone yet' : 'No recent posts from your follows'}
          </Text>
          <Text style={styles.emptySub}>Find creators to fill this feed.</Text>
          <TouchableOpacity style={styles.findBtn} activeOpacity={0.85} onPress={() => navigation.navigate('FindPeople')}>
            <Icon name="person-add" size={16} color={COLORS.black} />
            <Text style={styles.findBtnText}>Find people</Text>
          </TouchableOpacity>
        </View>
      }
    />
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.pageBackground },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: responsiveSize(80), paddingHorizontal: 40, gap: 8 },
  grid: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 120 },
  row: { justifyContent: 'space-between' },
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
