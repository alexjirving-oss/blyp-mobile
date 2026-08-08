import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Icon from '../Icon';

/**
 * Viewer live bottom bar — gift/game sheet materials.
 * Ink glass comment field + hero Gift ring; micro kickers under actions.
 */
export default function LiveBottomBar({
  onPressComment,
  onPressLike,
  onPressShare,
  onPressGift,
  onPressGames,
  showGames = false,
  gamesActive = false,
  likeCount,
  likeScale,
}) {
  const scaleStyle = likeScale ? { transform: [{ scale: likeScale }] } : null;
  const showLikeCount = Number.isFinite(Number(likeCount));

  return (
    <View style={styles.container} pointerEvents="box-none">
      <TouchableOpacity
        style={styles.commentField}
        onPress={onPressComment}
        activeOpacity={0.82}
        accessibilityRole="button"
        accessibilityLabel="Open live chat"
      >
        <Text style={styles.commentPlaceholder} allowFontScaling={false}>
          Say something…
        </Text>
        <View style={styles.commentEmojiWrap}>
          <Icon name="happy-outline" size={17} color="rgba(255,255,255,0.55)" />
        </View>
      </TouchableOpacity>

      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.action}
          onPress={onPressLike}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Like"
        >
          <Animated.View style={[styles.actionButton, styles.likeButton, scaleStyle]}>
            <Icon name="heart" size={20} color="#FB7185" />
            {showLikeCount ? (
              <Text style={styles.likeCount} allowFontScaling={false}>
                {Number(likeCount) > 999 ? '999+' : String(likeCount)}
              </Text>
            ) : null}
          </Animated.View>
          <Text style={styles.actionLabel} allowFontScaling={false}>
            LIKE
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.action}
          onPress={onPressGift}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Send gift"
        >
          <LinearGradient
            colors={['#5EEAD4', '#00D2BE', '#0D9488']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.giftRing}
          >
            <View style={styles.giftInner}>
              <View style={styles.giftGloss} pointerEvents="none" />
              <Icon name="gift" size={20} color="#5EEAD4" />
            </View>
          </LinearGradient>
          <Text style={[styles.actionLabel, styles.giftLabel]} allowFontScaling={false}>
            GIFT
          </Text>
        </TouchableOpacity>

        {showGames ? (
          <TouchableOpacity
            style={styles.action}
            onPress={onPressGames}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Live games"
          >
            <View style={[styles.actionButton, gamesActive && styles.gamesButtonActive]}>
              <Icon
                name="game-controller"
                size={20}
                color={gamesActive ? '#0A0A0C' : '#FDE68A'}
              />
            </View>
            <Text
              style={[styles.actionLabel, gamesActive && styles.gamesLabelActive]}
              allowFontScaling={false}
            >
              GAMES
            </Text>
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity
          style={styles.action}
          onPress={onPressShare}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Share live"
        >
          <View style={styles.actionButton}>
            <Icon name="share" size={18} color="#fff" />
          </View>
          <Text style={styles.actionLabel} allowFontScaling={false}>
            SHARE
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    paddingHorizontal: 12,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
  },
  commentField: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 46,
    borderRadius: 16,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(10,10,12,0.86)',
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.34)',
    marginBottom: 14,
  },
  commentPlaceholder: {
    color: 'rgba(255,255,255,0.48)',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.1,
    flexShrink: 1,
  },
  commentEmojiWrap: {
    width: 28,
    height: 28,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  action: {
    alignItems: 'center',
    minWidth: 46,
  },
  actionButton: {
    minWidth: 46,
    height: 46,
    borderRadius: 16,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10,10,12,0.86)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  likeButton: {
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 11,
    backgroundColor: 'rgba(251,113,133,0.12)',
    borderColor: 'rgba(251,113,133,0.38)',
  },
  likeCount: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
  },
  giftRing: {
    width: 48,
    height: 48,
    borderRadius: 17,
    padding: 2,
  },
  giftInner: {
    flex: 1,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10,10,12,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.28)',
    overflow: 'hidden',
  },
  giftGloss: {
    position: 'absolute',
    top: 3,
    left: 4,
    right: 4,
    height: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  gamesButtonActive: {
    backgroundColor: '#FDE68A',
    borderColor: '#FBBF24',
  },
  actionLabel: {
    color: 'rgba(255,255,255,0.62)',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.1,
    marginTop: 5,
  },
  giftLabel: {
    color: '#5EEAD4',
  },
  gamesLabelActive: {
    color: '#FDE68A',
  },
});
