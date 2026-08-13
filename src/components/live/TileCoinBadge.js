/**
 * Session gift-coin tally badge for host / guest tiles during a live.
 * Shows coins received THIS stream only (not lifetime wallet).
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    backgroundColor: 'rgba(251,191,36,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.55)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 10,
    zIndex: 40,
  },
  guestPos: { left: 6, bottom: 6 },
  hostPos: { left: 12, top: 12 },
  text: { color: '#FDE68A', fontSize: 11, fontWeight: '900', letterSpacing: 0.2 },
});

export const tileCoinPositions = {
  guest: styles.guestPos,
  host: styles.hostPos,
};

export function coinsFromGiftTotals(giftTotalsByUser, userId) {
  if (!userId) return 0;
  const t = giftTotalsByUser && giftTotalsByUser[userId];
  const c = t ? Number(t.coins) : 0;
  return c > 0 ? c : 0;
}

export default function TileCoinBadge({ coins, style }) {
  if (!coins || coins <= 0) return null;
  return (
    <View style={[styles.badge, style]} pointerEvents="none">
      <Text style={styles.text} allowFontScaling={false}>
        {String(coins)}
      </Text>
    </View>
  );
}
