import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import Icon from '../Icon';

export default function LiveBottomBar({
  onPressComment,
  onPressLike,
  onPressShare,
  onPressGift,
  likeCount,
  likeScale,
}: {
  onPressComment?: () => void;
  onPressLike?: () => void;
  onPressShare?: () => void;
  onPressGift?: () => void;
  likeCount?: number;
  likeScale?: any;
}) {
  const scaleStyle = likeScale
    ? {
        transform: [{ scale: likeScale }],
      }
    : null;

  return (
    <View style={styles.container} pointerEvents="box-none">
      <View style={styles.row}>
        <TouchableOpacity style={styles.button} onPress={onPressComment} activeOpacity={0.8}>
          <Icon name="chatbubble" size={22} color="#fff" style={{}} strokeWidth={undefined} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.button} onPress={onPressShare} activeOpacity={0.8}>
          <Icon name="share" size={22} color="#fff" style={{}} strokeWidth={undefined} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.button} onPress={onPressGift} activeOpacity={0.8}>
          <Icon name="gift" size={22} color="#fff" style={{}} strokeWidth={undefined} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.likeButton} onPress={onPressLike} activeOpacity={0.8}>
          <Animated.View style={scaleStyle}>
            <Icon name="heart" size={22} color="#fff" style={{}} strokeWidth={undefined} />
          </Animated.View>
          <Text style={styles.likeCount} allowFontScaling={false}>
            {Number.isFinite(Number(likeCount)) ? likeCount : 0}
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
    paddingBottom: 10,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 12,
  },
  button: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  likeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.35)',
    gap: 8,
  },
  likeCount: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
