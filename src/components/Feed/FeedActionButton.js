import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BLYP_LOGO_GRADIENT_COLORS } from '../BlypLogo';

/** Compact count formatter (1.2K / 3.4M) for feed action buttons. */
export function formatFeedCount(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(Math.max(0, Math.trunc(n)));
}

/** Teal-ring action button with count underneath (For You / MediaViewer). */
export function FeedActionButton({ onPress, children, active = false, count = 0 }) {
  return (
    <TouchableOpacity
      style={styles.outer}
      activeOpacity={0.85}
      delayPressIn={0}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
      onPress={(event) => {
        event?.stopPropagation?.();
        onPress?.(event);
      }}
    >
      <View style={styles.stack}>
        <LinearGradient
          colors={BLYP_LOGO_GRADIENT_COLORS}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.ring}
        >
          {active ? (
            <LinearGradient
              colors={BLYP_LOGO_GRADIENT_COLORS}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.inner}
            >
              <View style={styles.gloss} pointerEvents="none" />
              {children}
            </LinearGradient>
          ) : (
            <View style={styles.inner}>
              <View style={styles.gloss} pointerEvents="none" />
              {children}
            </View>
          )}
        </LinearGradient>
        <Text style={styles.count} allowFontScaling={false}>
          {formatFeedCount(count)}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

/** Non-interactive stat matching FeedActionButton chrome (e.g. views). */
export function FeedStatBadge({ children, count = 0 }) {
  return (
    <View style={styles.outer} pointerEvents="none">
      <View style={styles.stack}>
        <LinearGradient
          colors={BLYP_LOGO_GRADIENT_COLORS}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.ring}
        >
          <View style={styles.inner}>
            <View style={styles.gloss} pointerEvents="none" />
            {children}
          </View>
        </LinearGradient>
        <Text style={styles.count} allowFontScaling={false}>
          {formatFeedCount(count)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 44,
  },
  stack: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    width: 48,
    height: 48,
    borderRadius: 24,
    padding: 2,
  },
  inner: {
    flex: 1,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(20,20,24,0.82)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  gloss: {
    position: 'absolute',
    top: 4,
    left: 5,
    right: 5,
    height: 14,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  count: {
    marginTop: 4,
    color: 'rgba(255,255,255,0.92)',
    fontSize: 11,
    fontWeight: '700',
    includeFontPadding: false,
    textAlign: 'center',
  },
});

export default FeedActionButton;
