/**
 * One vertical feed cell — video covers the frame; creator pill overlaid.
 */
import React, { memo, useCallback } from 'react';
import {
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import InstantPlayer from './InstantPlayer';
import { resolvePlayableUri } from '../resolvePlayableUri';
import { playbackFlags, shouldLoadCell } from './engine';
import { fixStorageUrl } from '../../utils/urlUtils';

function InstantCell({
  item,
  index,
  activeIndex,
  loadIndex,
  height,
  feedMuted,
  paused,
  onPressVideo,
  onPressCreator,
}) {
  const playback = resolvePlayableUri(item);
  const videoUri = playback.playUri || null;
  const fallbackUris = (playback.ladder || []).filter((u) => u && u !== videoUri);
  const load = shouldLoadCell(index, activeIndex, loadIndex);
  const flags = playbackFlags({
    index,
    activeIndex,
    feedMuted,
    paused,
  });

  const handle = item?.userDisplayName
    || item?.user?.displayName
    || item?.user?.username
    || item?.username
    || 'user';

  const avatar =
    fixStorageUrl(
      item?.userPhotoURL
        || item?.user?.avatar
        || item?.user?.photoURL
        || '',
    ) || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop&crop=face';

  const onVideo = useCallback(() => {
    onPressVideo?.(item);
  }, [item, onPressVideo]);

  const onCreator = useCallback(() => {
    onPressCreator?.(item);
  }, [item, onPressCreator]);

  return (
    <View style={[styles.cell, { height }]}>
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onVideo}>
        <InstantPlayer
          uri={videoUri}
          fallbackUris={fallbackUris}
          poster={fixStorageUrl(item?.thumbnail || item?.imageUrl || '') || undefined}
          style={StyleSheet.absoluteFill}
          shouldPlay={flags.shouldPlay}
          shouldLoad={load}
          isMuted={flags.isMuted}
          role={flags.role}
        />
      </TouchableOpacity>

      <View style={styles.topRow} pointerEvents="box-none">
        <TouchableOpacity style={styles.pill} activeOpacity={0.88} onPress={onCreator}>
          <Image source={{ uri: avatar }} style={styles.avatar} />
          <Text style={styles.handle} allowFontScaling={false} numberOfLines={1}>
            @{String(handle).replace(/^@/, '')}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default memo(InstantCell);

const styles = StyleSheet.create({
  cell: {
    width: '100%',
    backgroundColor: '#000',
    overflow: 'hidden',
  },
  topRow: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    zIndex: 4,
    flexDirection: 'row',
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(10,10,12,0.55)',
    borderRadius: 22,
    paddingVertical: 4,
    paddingLeft: 4,
    paddingRight: 12,
    maxWidth: '78%',
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    marginRight: 8,
    backgroundColor: '#222',
  },
  handle: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    flexShrink: 1,
  },
});
