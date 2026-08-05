import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Icon from '../Icon';
import { COLORS } from '../../styles/theme';

const formatCount = (value) => {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return '0';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(Math.max(0, Math.trunc(n)));
};

/**
 * Solid view / gift coin pills shared by For You + MediaViewer top chrome.
 * Filled glyphs + denser pill so they read on Fold unfold and phone alike.
 */
export default function FeedTopStatPills({ views = 0, gifts = 0, style }) {
  return (
    <View style={[styles.cluster, style]} pointerEvents="none">
      <View style={styles.pill}>
        <Icon name="eye" size={15} color={COLORS.white} fill={COLORS.white} strokeWidth={1.5} />
        <Text style={styles.text} allowFontScaling={false}>{formatCount(views)}</Text>
      </View>
      <View style={styles.pill}>
        <Icon name="gift" size={15} color={COLORS.white} fill={COLORS.white} strokeWidth={1.5} />
        <Text style={styles.text} allowFontScaling={false}>{formatCount(gifts)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 30,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(10,10,12,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  text: {
    color: COLORS.white,
    fontSize: 13,
    fontWeight: '800',
    includeFontPadding: false,
  },
});
