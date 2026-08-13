/**
 * Immersive live viewer header — gift/games sheet quality bar.
 * Near-black ink glass, PETRONAS teal, 900 type, restrained chrome.
 */
import React from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Icon from '../Icon';

const TEAL = '#00D2BE';
const INK = '#0A0A0C';

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
  onPressReport,
  onPressClose,
}) {
  return (
    <View style={[styles.root, { top: topInset }]} pointerEvents="box-none">
      <LinearGradient
        colors={['rgba(10,10,12,0.72)', 'rgba(10,10,12,0.28)', 'transparent']}
        locations={[0, 0.62, 1]}
        pointerEvents="none"
        style={styles.topVignette}
      />

      <View style={styles.row} pointerEvents="box-none">
        <View style={styles.hostCard}>
          <LinearGradient
            colors={['rgba(0,210,190,0.55)', 'rgba(0,210,190,0.12)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.avatarRing}
          >
            {hostPhotoUrl ? (
              <Image source={{ uri: hostPhotoUrl }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback]}>
                <Text style={styles.avatarInitial} allowFontScaling={false}>
                  {String(hostName || 'H').charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
          </LinearGradient>

          <View style={styles.hostMeta}>
            <Text style={styles.hostName} numberOfLines={1} allowFontScaling={false}>
              {hostName}
            </Text>
            <View style={styles.liveRow}>
              <View style={styles.livePill}>
                <View style={styles.liveDot} />
                <Text style={styles.liveText} allowFontScaling={false}>
                  LIVE
                </Text>
              </View>
              <Text style={styles.watchingKicker} allowFontScaling={false}>
                WATCHING
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.rightCluster}>
          <View style={styles.statsCard}>
            <View style={styles.statCell}>
              <Icon name="eye" size={12} color="rgba(255,255,255,0.92)" />
              <Text style={styles.statText} allowFontScaling={false}>
                {formatCount(viewCount)}
              </Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statCell}>
              <Icon name="heart" size={12} color="#FB7185" />
              <Text style={styles.statText} allowFontScaling={false}>
                {formatCount(heartCount)}
              </Text>
            </View>
          </View>

          {typeof onPressReport === 'function' ? (
            <TouchableOpacity
              style={[styles.iconBtn, styles.reportBtn]}
              onPress={onPressReport}
              hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
              accessibilityLabel="Report live"
              accessibilityRole="button"
            >
              <Icon name="flag" size={16} color="#fff" />
            </TouchableOpacity>
          ) : null}

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
            <Icon name="close" size={17} color="#fff" />
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
    top: -10,
    height: 108,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 10,
  },
  hostCard: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    minWidth: 0,
    maxWidth: '62%',
    paddingLeft: 4,
    paddingRight: 12,
    paddingVertical: 4,
    borderRadius: 18,
    backgroundColor: 'rgba(10,10,12,0.82)',
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.42)',
  },
  avatarRing: {
    width: 40,
    height: 40,
    borderRadius: 20,
    padding: 1.5,
    marginRight: 9,
  },
  avatar: {
    width: '100%',
    height: '100%',
    borderRadius: 18.5,
    backgroundColor: INK,
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,210,190,0.22)',
  },
  avatarInitial: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 15,
  },
  hostMeta: {
    flexShrink: 1,
    minWidth: 0,
    paddingVertical: 1,
  },
  hostName: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 14,
    letterSpacing: 0.15,
    flexShrink: 1,
  },
  liveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 3,
    gap: 7,
  },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E11D48',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
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
    fontSize: 9,
    letterSpacing: 0.9,
  },
  watchingKicker: {
    color: TEAL,
    fontWeight: '900',
    fontSize: 9,
    letterSpacing: 1.4,
  },
  rightCluster: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 14,
    backgroundColor: 'rgba(10,10,12,0.78)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    gap: 8,
  },
  statCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statDivider: {
    width: 1,
    height: 12,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  statText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 12,
    letterSpacing: 0.1,
  },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10,10,12,0.78)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  reportBtn: {
    backgroundColor: 'rgba(251,113,133,0.28)',
    borderColor: 'rgba(251,113,133,0.45)',
  },
  closeBtn: {
    borderColor: 'rgba(0,210,190,0.42)',
    backgroundColor: 'rgba(0,210,190,0.12)',
  },
});
