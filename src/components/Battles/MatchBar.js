// MatchBar — TikTok-style push-pull score bar for live 1v1 battles.
// Left (host/creator) = Blyp teal; right (opponent) = warm coral.
// Fill ratio animates with RN Animated as gift/vote scores change.

import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { COLORS } from '../../styles/theme';
import { responsiveFont, responsiveSize } from '../../utils/scaleUtils';

export const MATCH_BAR_LEFT = COLORS.primary; // #00D2BE
export const MATCH_BAR_RIGHT = '#FF5A45';

/**
 * @param {object} props
 * @param {number} props.leftScore
 * @param {number} props.rightScore
 * @param {string} [props.leftLabel]
 * @param {string} [props.rightLabel]
 * @param {boolean} [props.compact]
 * @param {boolean} [props.showScores]
 */
export default function MatchBar({
  leftScore = 0,
  rightScore = 0,
  leftLabel,
  rightLabel,
  compact = false,
  showScores = true,
}) {
  const left = Math.max(0, Number(leftScore) || 0);
  const right = Math.max(0, Number(rightScore) || 0);
  const total = left + right;
  const targetRatio = total > 0 ? left / total : 0.5;

  const ratio = useRef(new Animated.Value(targetRatio)).current;
  const pulse = useRef(new Animated.Value(1)).current;
  const prevTotalRef = useRef(total);

  useEffect(() => {
    Animated.spring(ratio, {
      toValue: Math.min(0.92, Math.max(0.08, targetRatio)),
      friction: 9,
      tension: 68,
      useNativeDriver: false,
    }).start();
  }, [targetRatio, ratio]);

  // Subtle pulse on the seam when totals change (gift landed).
  useEffect(() => {
    if (total === prevTotalRef.current) return;
    prevTotalRef.current = total;
    pulse.setValue(1);
    Animated.sequence([
      Animated.timing(pulse, {
        toValue: 1.35,
        duration: 120,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(pulse, {
        toValue: 1,
        duration: 220,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
  }, [total, pulse]);

  const leftWidth = ratio.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  const seamLeft = ratio.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  const barH = compact ? responsiveSize(10) : responsiveSize(14);

  return (
    <View style={styles.wrap} pointerEvents="none">
      {(leftLabel || rightLabel || showScores) && (
        <View style={styles.labels}>
          <View style={styles.labelSide}>
            {showScores ? (
              <Text style={[styles.score, styles.scoreLeft]} numberOfLines={1}>
                {Math.round(left)}
              </Text>
            ) : null}
            {leftLabel ? (
              <Text style={styles.name} numberOfLines={1}>{leftLabel}</Text>
            ) : null}
          </View>
          <View style={styles.labelSideRight}>
            {rightLabel ? (
              <Text style={[styles.name, styles.nameRight]} numberOfLines={1}>{rightLabel}</Text>
            ) : null}
            {showScores ? (
              <Text style={[styles.score, styles.scoreRight]} numberOfLines={1}>
                {Math.round(right)}
              </Text>
            ) : null}
          </View>
        </View>
      )}

      <View style={[styles.track, { height: barH, borderRadius: barH / 2 }]}>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: MATCH_BAR_RIGHT }]} />
        <Animated.View
          style={[
            styles.leftFill,
            {
              width: leftWidth,
              backgroundColor: MATCH_BAR_LEFT,
              borderTopLeftRadius: barH / 2,
              borderBottomLeftRadius: barH / 2,
            },
          ]}
        />
        <Animated.View
          style={[
            styles.seam,
            {
              left: seamLeft,
              height: barH + responsiveSize(6),
              marginTop: -responsiveSize(3),
              transform: [{ translateX: -responsiveSize(5) }, { scale: pulse }],
            },
          ]}
        >
          <View style={styles.seamCore} />
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
  },
  labels: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: responsiveSize(6),
    paddingHorizontal: responsiveSize(2),
  },
  labelSide: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: responsiveSize(6),
    paddingRight: responsiveSize(8),
  },
  labelSideRight: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: responsiveSize(6),
    paddingLeft: responsiveSize(8),
  },
  name: {
    flexShrink: 1,
    color: 'rgba(255,255,255,0.92)',
    fontSize: responsiveFont(12),
    fontWeight: '700',
  },
  nameRight: {
    textAlign: 'right',
  },
  score: {
    fontSize: responsiveFont(16),
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  scoreLeft: {
    color: MATCH_BAR_LEFT,
  },
  scoreRight: {
    color: MATCH_BAR_RIGHT,
  },
  track: {
    width: '100%',
    overflow: 'visible',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  leftFill: {
    height: '100%',
  },
  seam: {
    position: 'absolute',
    top: 0,
    width: responsiveSize(10),
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  seamCore: {
    width: responsiveSize(4),
    height: '100%',
    borderRadius: responsiveSize(2),
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
});
