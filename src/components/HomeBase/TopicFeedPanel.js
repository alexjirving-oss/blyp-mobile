// TopicFeedPanel.js
//
// A dedicated, real feed for one topic/interest page (e.g. "Football"). Pulls
// matching posts from Firestore via discoveryService and renders a 2-column
// grid. Used by HomeScreen for any page whose key starts with `topic:`.

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
import { getTopicPosts } from '../../services/discoveryService';
import { postThumbnail } from '../../services/blypAiService';
import { mediaViewerParams } from '../../utils/mediaViewerPlaylist';
import TopicNotificationToggle from '../TopicNotificationToggle';

const TopicFeedPanel = ({ navigation, uid, topicId, label }) => {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const terms = String(label || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  const load = useCallback(async () => {
    const res = await getTopicPosts(terms, 40);
    setPosts(res);
    setLoading(false);
    setRefreshing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const openPost = (post) => navigation.navigate('MediaViewer', mediaViewerParams(post, posts));
  const openBlyp = () => navigation.navigate('Blyp', { initialQuery: label });

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
        <Text style={styles.cardTitle} numberOfLines={2}>
          {item.title || item.caption || item.description || 'Post'}
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
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            load();
          }}
          tintColor={COLORS.primary}
        />
      }
      ListHeaderComponent={
        <View>
          <TopicNotificationToggle
            uid={uid}
            topicId={topicId}
            label={label || 'Topic'}
            description="Key updates when a verified topic feed publishes them"
            style={styles.notificationToggle}
          />
          <TouchableOpacity style={styles.askRow} activeOpacity={0.85} onPress={openBlyp}>
            <Icon name="sparkles" size={15} color={COLORS.primary} />
            <Text style={styles.askText}>Ask Blyp about {label}</Text>
            <Icon name="arrow-forward" size={15} color={COLORS.primary} />
          </TouchableOpacity>
        </View>
      }
      ListEmptyComponent={
        <View style={styles.center}>
          <Icon name="albums-outline" size={42} color={COLORS.textMuted} />
          <Text style={styles.emptyText}>No {label} posts yet</Text>
          <Text style={styles.emptySub}>Try asking Blyp, or check back soon.</Text>
        </View>
      }
    />
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.pageBackground },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: responsiveSize(80), gap: 8 },
  grid: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 120 },
  row: { justifyContent: 'space-between' },

  notificationToggle: { marginBottom: 12 },
  askRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(0,210,190,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.35)',
    marginBottom: 14,
  },
  askText: { flex: 1, color: COLORS.primary, fontSize: responsiveFont(14), fontWeight: '700' },

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
  cardTitle: { color: COLORS.textSecondary, fontSize: responsiveFont(13), marginTop: 6, lineHeight: responsiveFont(18) },

  emptyText: { color: COLORS.textPrimary, fontSize: responsiveFont(15), fontWeight: '700', marginTop: 6 },
  emptySub: { color: COLORS.textMuted, fontSize: responsiveFont(13) },
});

export default TopicFeedPanel;
