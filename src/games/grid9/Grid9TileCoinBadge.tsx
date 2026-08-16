import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatGrid9Coins } from './grid9Format';

/**
 * TikTok-style tile coin counter: gold coin + number, top-right of the cam.
 * Grid9-local copy of live TileCoinBadge placement/prominence — not a ⚡ box,
 * and does not edit frozen LIVE files.
 */
export function Grid9TileCoinBadge({
  coins,
  compact = false,
}: {
  coins: number;
  compact?: boolean;
}) {
  const amount = Math.max(0, Math.floor(coins));
  return (
    <View
      pointerEvents="none"
      style={[styles.badge, compact ? styles.compact : null]}
    >
      <View style={styles.coin}>
        <View style={styles.coinInner} />
      </View>
      <Text style={styles.text} allowFontScaling={false} numberOfLines={1}>
        {formatGrid9Coins(amount)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: 4,
    right: 4,
    zIndex: 40,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.62)',
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.7)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 12,
  },
  compact: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 10,
  },
  coin: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#F5C518',
    marginRight: 5,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#B45309',
  },
  coinInner: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#FDE68A',
  },
  text: {
    color: '#FDE68A',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
});
