// BlypResultsScreen.js
//
// The "See all" destination from a Blyp search. Shows the full set of matched
// posts/videos as a clean vertical feed you swipe through, one after another.
// Tapping a card opens the full media viewer.

import React from 'react';
import { FlatList, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import Icon from '../components/Icon';
import { COLORS } from '../styles/theme';
import { responsiveFont, responsiveSize } from '../utils/scaleUtils';
import { postThumbnail } from '../services/blypAiService';

const isVideoPost = (p) =>
  p?.type === 'video' || !!p?.media?.[0]?.type?.includes?.('video') || !!p?.videoUrl;

const BlypResultsScreen = ({ navigation, route }) => {
  const posts = route?.params?.posts || [];
  const title = route?.params?.title || 'Results';
  const query = route?.params?.query || '';

  // Hand the viewer this result set's videos (tapped one first) so swiping up
  // continues through the search results, not the creator's own uploads.
  const openPost = (post) => {
    const vids = (posts || []).filter((p) => p && isVideoPost(p));
    const playlist = isVideoPost(post)
      ? [post, ...vids.filter((p) => p && p.id !== post.id)]
      : [];
    if (playlist.length > 1) navigation.navigate('MediaViewer', { post, posts: playlist });
    else navigation.navigate('MediaViewer', { post });
  };

  const renderItem = ({ item }) => {
    const uri = postThumbnail(item);
    const caption = item.title || item.captionTitle || item.caption || item.description || 'Post';
    const author = item.username || item.userDisplayName || item.displayName;
    const isVideo = isVideoPost(item);
    return (
      <TouchableOpacity style={styles.card} activeOpacity={0.9} onPress={() => openPost(item)}>
        <View style={styles.thumbWrap}>
          {uri ? (
            <Image source={{ uri }} style={styles.thumb} resizeMode="cover" />
          ) : (
            <View style={[styles.thumb, styles.thumbFallback]}>
              <Icon name="image-outline" size={34} color={COLORS.textMuted} />
            </View>
          )}
          {isVideo && (
            <View style={styles.playBadge}>
              <Icon name="play" size={20} color={COLORS.white} />
            </View>
          )}
        </View>
        <View style={styles.meta}>
          <Text style={styles.caption} numberOfLines={2}>{caption}</Text>
          {!!author && <Text style={styles.author} numberOfLines={1}>@{author}</Text>}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <ScreenContainer>
      <View style={styles.topRow}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Icon name="chevron-back" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={styles.titleWrap}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          {!!query && <Text style={styles.subtitle} numberOfLines={1}>for “{query}”</Text>}
        </View>
        <View style={styles.backBtn} />
      </View>

      <FlatList
        data={posts}
        keyExtractor={(item, i) => String(item.id || i)}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Icon name="search-outline" size={40} color={COLORS.textMuted} />
            <Text style={styles.emptyText}>Nothing to show here.</Text>
          </View>
        }
      />
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  topRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: responsiveSize(8), marginBottom: 8 },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  titleWrap: { flex: 1, alignItems: 'center' },
  title: { color: COLORS.textPrimary, fontSize: responsiveFont(17), fontWeight: '800' },
  subtitle: { color: COLORS.textMuted, fontSize: responsiveFont(12), marginTop: 1 },
  list: { paddingHorizontal: 12, paddingBottom: 120 },
  card: { marginBottom: 18 },
  thumbWrap: { position: 'relative', width: '100%', aspectRatio: 1, borderRadius: 16, overflow: 'hidden' },
  thumb: { width: '100%', height: '100%', backgroundColor: COLORS.surface },
  thumbFallback: { alignItems: 'center', justifyContent: 'center' },
  playBadge: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginLeft: -22,
    marginTop: -22,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  meta: { paddingHorizontal: 4, paddingTop: 10 },
  caption: { color: COLORS.textPrimary, fontSize: responsiveFont(15), fontWeight: '700', lineHeight: responsiveFont(21) },
  author: { color: COLORS.textMuted, fontSize: responsiveFont(13), marginTop: 4 },
  emptyWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 80, gap: 10 },
  emptyText: { color: COLORS.textSecondary, fontSize: responsiveFont(14) },
});

export default BlypResultsScreen;
