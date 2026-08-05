import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import Icon from '../Icon';

/**
 * Unified live bottom bar. A tappable comment field on the left opens the
 * composer; on the right, labeled circular actions (Like / Gift / Games / Share)
 * match the approved design. Shared by host and viewer so the room reads as
 * one app.
 */
export default function LiveBottomBar({
  onPressComment,
  onPressLike,
  onPressShare,
  onPressGift,
  onPressGames,
  showGames = false,
  gamesActive = false,
  likeScale,
}) {
  const scaleStyle = likeScale ? { transform: [{ scale: likeScale }] } : null;

  return (
    <View style={styles.container} pointerEvents="box-none">
      <TouchableOpacity
        style={styles.commentField}
        onPress={onPressComment}
        activeOpacity={0.8}
      >
        <Text style={styles.commentPlaceholder} allowFontScaling={false}>
          Comment
        </Text>
        <Icon name="happy-outline" size={20} color="rgba(255,255,255,0.6)" />
      </TouchableOpacity>

      <View style={styles.actions}>
        <TouchableOpacity style={styles.action} onPress={onPressLike} activeOpacity={0.8}>
          <Animated.View style={[styles.actionButton, scaleStyle]}>
            <Icon name="heart" size={22} color="#FB7185" />
          </Animated.View>
          <Text style={styles.actionLabel} allowFontScaling={false}>Like</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.action} onPress={onPressGift} activeOpacity={0.8}>
          <View style={[styles.actionButton, styles.giftButton]}>
            <Icon name="gift" size={22} color="#5EEAD4" />
          </View>
          <Text style={styles.actionLabel} allowFontScaling={false}>Gift</Text>
        </TouchableOpacity>

        {showGames ? (
          <TouchableOpacity style={styles.action} onPress={onPressGames} activeOpacity={0.8}>
            <View style={[styles.actionButton, gamesActive && styles.gamesButtonActive]}>
              <Icon name="game-controller" size={22} color={gamesActive ? '#0A0A0C' : '#FDE68A'} />
            </View>
            <Text style={styles.actionLabel} allowFontScaling={false}>Games</Text>
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity style={styles.action} onPress={onPressShare} activeOpacity={0.8}>
          <View style={styles.actionButton}>
            <Icon name="share" size={20} color="#fff" />
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
    paddingBottom: 10,
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
    borderRadius: 23,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(10,10,12,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    marginBottom: 18,
  },
  commentPlaceholder: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
    fontWeight: '500',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
  },
  action: {
    alignItems: 'center',
    width: 46,
  },
  actionButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10,10,12,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
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
    color: 'rgba(255,255,255,0.85)',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 4,
  },
});
