/**
 * TikTok / IG Live–class viewer chrome: host chip, LIVE pill, stats, actions.
 * Visual language matches gift sheet + games picker (glass / teal / near-black).
 */
import React from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Icon from '../Icon';

const TEAL = '#00D2BE';

function formatCount(n) {
  const v = Number(n) || 0;
  if (v >= 1000000) return `${(v / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
  if (v >= 10000) return `${Math.round(v / 1000)}K`;
  if (v >= 1000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(v);
}

export default function LiveViewerHeader({
  topInset = 0,
  hostName = 'Host',
  hostPhotoUrl,
  viewCount = 0,
  heartCount = 0,
  onPressMore,
  onPressClose,
}) {
  return (
    <View style={[styles.root, { top: topInset }]} pointerEvents="box-none">
      <LinearGradient
        colors={['rgba(10,10,12,0.55)', 'rgba(10,10,12,0.18)', 'transparent']}
        locations={[0, 0.55, 1]}
        pointerEvents="none"
        style={styles.topVignette}
      />

      <View style={styles.row} pointerEvents="box-none">
        <View style={styles.hostChip}>
          {hostPhotoUrl ? (
            <Image source={{ uri: hostPhotoUrl }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Text style={styles.avatarInitial} allowFontScaling={false}>
                {String(hostName || 'H').charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
          <View style={styles.hostMeta}>
            <Text style={styles.hostName} numberOfLines={1} allowFontScaling={false}>
              {hostName}
            </Text>
            <View style={styles.livePill}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText} allowFontScaling={false}>
                LIVE
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.rightCluster}>
          <View style={styles.statChip}>
            <Icon name="eye" size={13} color="#fff" />
            <Text style={styles.statText} allowFontScaling={false}>
              {formatCount(viewCount)}
            </Text>
          </View>
          <View style={styles.statChip}>
            <Icon name="heart" size={13} color="#FB7185" />
            <Text style={styles.statText} allowFontScaling={false}>
              {formatCount(heartCount)}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={onPressMore}
            hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
            accessibilityLabel="More options"
          >
            <Icon name="ellipsis-horizontal" size={18} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.iconBtn, styles.closeBtn]}
            onPress={onPressClose}
            hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
            accessibilityLabel="Leave live"
          >
            <Icon name="close" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 1200,
    elevation: 1200,
  },
  topVignette: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: -8,
    height: 96,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 8,
  },
  hostChip: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    minWidth: 0,
    maxWidth: '58%',
    paddingLeft: 3,
    paddingRight: 10,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(10,10,12,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.38)',
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    marginRight: 8,
    borderWidth: 1.5,
    borderColor: TEAL,
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,210,190,0.22)',
  },
  avatarInitial: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 14,
  },
  hostMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    minWidth: 0,
    gap: 8,
  },
  hostName: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 14,
    flexShrink: 1,
    minWidth: 0,
    letterSpacing: 0.1,
  },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E11D48',
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  liveDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#fff',
    marginRight: 4,
  },
  liveText: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 10,
    letterSpacing: 0.6,
  },
  rightCluster: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(10,10,12,0.62)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  statText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 12,
  },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10,10,12,0.62)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  closeBtn: {
    borderColor: 'rgba(0,210,190,0.35)',
  },
});

