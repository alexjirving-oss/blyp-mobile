import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import Icon from '../Icon';

/**
 * Unified live bottom bar. Comment field on the left; glass action pills on the
 * right (Like / Gift / Games / Share). Shared by host and viewer so the room
 * reads as one product — aligned with gift / games sheet chrome.
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
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel="Open live chat"
      >
        <Text style={styles.commentPlaceholder} allowFontScaling={false}>
          Say something...
        </Text>
        <Icon name="happy-outline" size={18} color="rgba(255,255,255,0.55)" />
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
          <Text style={styles.actionLabel} allowFontScaling={false}>Like</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.action}
          onPress={onPressGift}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Send gift"
        >
          <View style={[styles.actionButton, styles.giftButton]}>
            <Icon name="gift" size={20} color="#5EEAD4" />
          </View>
          <Text style={styles.actionLabel} allowFontScaling={false}>Gift</Text>
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
              <Icon name="game-controller" size={20} color={gamesActive ? '#0A0A0C' : '#FDE68A'} />
            </View>
            <Text style={styles.actionLabel} allowFontScaling={false}>Games</Text>
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
          <Text style={styles.actionLabel} allowFontScaling={false}>Share</Text>
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
    height: 44,
    borderRadius: 22,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(10,10,12,0.62)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    marginBottom: 16,
  },
  commentPlaceholder: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 14,
    fontWeight: '500',
    flexShrink: 1,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
  },
  action: {
    alignItems: 'center',
    minWidth: 44,
  },
  actionButton: {
    minWidth: 44,
    height: 44,
    borderRadius: 22,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10,10,12,0.62)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  likeButton: {
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 11,
  },
  likeCount: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  giftButton: {
    backgroundColor: 'rgba(0,210,190,0.18)',
    borderColor: 'rgba(0,210,190,0.55)',
  },
  gamesButtonActive: {
    backgroundColor: '#FDE68A',
    borderColor: '#FBBF24',
  },
  actionLabel: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 10,
    fontWeight: '600',
    marginTop: 4,
  },
});
