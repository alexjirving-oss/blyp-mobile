// MatchBar — TikTok-style push-pull score bar for live 1v1 battles.
// Left (host/creator) = Blyp teal; right (opponent) = warm coral.
// Fill ratio animates with RN Animated as gift/vote scores change.
// Combo streaks + top-gifter avatars are opt-in overlays (performance-safe).

import React, { useEffect, useRef, useState, memo } from 'react';
import { View, Text, StyleSheet, Animated, Easing, Image } from 'react-native';
import { COLORS } from '../../styles/theme';
import { responsiveFont, responsiveSize } from '../../utils/scaleUtils';

export const MATCH_BAR_LEFT = COLORS.primary; // #FF2D55
export const MATCH_BAR_RIGHT = '#FF5A45';

const COMBO_IDLE_MS = 2600;
const COMBO_MIN = 2;

/**
 * @param {{ uid?: string, photoURL?: string, name?: string }[]} list
 * @param {string} accent
 * @param {'left'|'right'} align
 */
function TopGifterRow({ list, accent, align }) {
  if (!list?.length) return null;
  const items = list.slice(0, 3);
  return (
    <View style={[styles.gifterRow, align === 'right' && styles.gifterRowRight]}>
      {items.map((g, i) => {
        const key = g.uid || g.photoURL || String(i);
        const uri = g.photoURL || g.photo || '';
        return (
          <View
            key={key}
            style={[
              styles.gifterAvatarWrap,
              { borderColor: accent, zIndex: 3 - i, marginLeft: i === 0 || align === 'right' ? 0 : -responsiveSize(8) },
              align === 'right' && i > 0 ? { marginRight: -responsiveSize(8), marginLeft: 0 } : null,
            ]}
          >
            {uri ? (
              <Image source={{ uri }} style={styles.gifterAvatar} />
            ) : (
              <View style={[styles.gifterAvatar, styles.gifterFallback]}>
                <Text style={styles.gifterInitial}>
                  {String(g.name || '?').charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const ComboBadge = memo(function ComboBadge({ side, streak, mult }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.7)).current;
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (streak < COMBO_MIN) {
      Animated.timing(opacity, { toValue: 0, duration: 160, useNativeDriver: true }).start();
      return;
    }
    opacity.setValue(0);
    scale.setValue(0.7);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 140, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 6, tension: 140, useNativeDriver: true }),
    ]).start();
    pulse.setValue(1);
    Animated.sequence([
      Animated.timing(pulse, {
        toValue: 1.18,
        duration: 110,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(pulse, {
        toValue: 1,
        duration: 180,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
  }, [streak, mult, side, opacity, scale, pulse]);

  if (streak < COMBO_MIN) return null;
  const accent = side === 'left' ? MATCH_BAR_LEFT : MATCH_BAR_RIGHT;
  return (
    <Animated.View
      style={[
        styles.comboBadge,
        side === 'right' ? styles.comboBadgeRight : styles.comboBadgeLeft,
        { opacity, transform: [{ scale: Animated.multiply(scale, pulse) }], borderColor: accent },
      ]}
      pointerEvents="none"
    >
      <Text style={[styles.comboText, { color: accent }]}>
        x{streak}
      </Text>
      {mult > 1 ? (
        <Text style={styles.multText}>{mult.toFixed(1)}×</Text>
      ) : null}
    </Animated.View>
  );
});

/**
 * @param {object} props
 * @param {number} props.leftScore
 * @param {number} props.rightScore
 * @param {string} [props.leftLabel]
 * @param {string} [props.rightLabel]
 * @param {boolean} [props.compact]
 * @param {boolean} [props.showScores]
 * @param {{ uid?: string, photoURL?: string, name?: string }[]} [props.leftGifters]
 * @param {{ uid?: string, photoURL?: string, name?: string }[]} [props.rightGifters]
 * @param {{ side: 'left'|'right', streak: number, mult?: number }|null} [props.combo]
 */
export default function MatchBar({
  leftScore = 0,
  rightScore = 0,
  leftLabel,
  rightLabel,
  compact = false,
  showScores = true,
  leftGifters,
  rightGifters,
  combo = null,
}) {
  const left = Math.max(0, Number(leftScore) || 0);
  const right = Math.max(0, Number(rightScore) || 0);
  const total = left + right;
  const targetRatio = total > 0 ? left / total : 0.5;

  const ratio = useRef(new Animated.Value(targetRatio)).current;
  const pulse = useRef(new Animated.Value(1)).current;
  const sideGlow = useRef(new Animated.Value(0)).current;
  const prevTotalRef = useRef(total);
  const prevLeftRef = useRef(left);
  const prevRightRef = useRef(right);
  const [glowSide, setGlowSide] = useState(null);

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
    const dL = left - prevLeftRef.current;
    const dR = right - prevRightRef.current;
    prevTotalRef.current = total;
    prevLeftRef.current = left;
    prevRightRef.current = right;

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

    if (dL > 0 || dR > 0) {
      setGlowSide(dL >= dR ? 'left' : 'right');
      sideGlow.setValue(0);
      Animated.sequence([
        Animated.timing(sideGlow, { toValue: 1, duration: 120, useNativeDriver: true }),
        Animated.timing(sideGlow, { toValue: 0, duration: 420, useNativeDriver: true }),
      ]).start();
    }
  }, [total, left, right, pulse, sideGlow]);

  const leftWidth = ratio.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  const seamLeft = ratio.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  const barH = compact ? responsiveSize(10) : responsiveSize(14);
  const comboSide = combo?.side || null;
  const comboStreak = Number(combo?.streak) || 0;
  const comboMult = Number(combo?.mult) || (comboStreak >= 5 ? 1.5 : comboStreak >= 3 ? 1.2 : 1);

  return (
    <View style={styles.wrap} pointerEvents="none">
      {(leftGifters?.length || rightGifters?.length) ? (
        <View style={styles.gifterBand}>
          <TopGifterRow list={leftGifters} accent={MATCH_BAR_LEFT} align="left" />
          <View style={styles.gifterSpacer} />
          <TopGifterRow list={rightGifters} accent={MATCH_BAR_RIGHT} align="right" />
        </View>
      ) : null}

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
        {glowSide ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.sideGlow,
              glowSide === 'left' ? styles.sideGlowLeft : styles.sideGlowRight,
              {
                opacity: sideGlow.interpolate({ inputRange: [0, 1], outputRange: [0, 0.55] }),
                backgroundColor: glowSide === 'left' ? MATCH_BAR_LEFT : MATCH_BAR_RIGHT,
              },
            ]}
          />
        ) : null}
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
        <ComboBadge side={comboSide} streak={comboStreak} mult={comboMult} />
      </View>
    </View>
  );
}

export { COMBO_IDLE_MS, COMBO_MIN };

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
  },
  gifterBand: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: responsiveSize(6),
    minHeight: responsiveSize(22),
  },
  gifterSpacer: { flex: 1 },
  gifterRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  gifterRowRight: {
    flexDirection: 'row-reverse',
  },
  gifterAvatarWrap: {
    width: responsiveSize(22),
    height: responsiveSize(22),
    borderRadius: responsiveSize(11),
    borderWidth: 1.5,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  gifterAvatar: {
    width: '100%',
    height: '100%',
  },
  gifterFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  gifterInitial: {
    color: '#fff',
    fontSize: responsiveFont(9),
    fontWeight: '800',
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
  sideGlow: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '28%',
  },
  sideGlowLeft: {
    left: 0,
  },
  sideGlowRight: {
    right: 0,
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
  comboBadge: {
    position: 'absolute',
    top: -responsiveSize(22),
    flexDirection: 'row',
    alignItems: 'center',
    gap: responsiveSize(4),
    backgroundColor: 'rgba(10,10,12,0.82)',
    borderWidth: 1,
    borderRadius: responsiveSize(12),
    paddingHorizontal: responsiveSize(8),
    paddingVertical: responsiveSize(3),
    zIndex: 4,
  },
  comboBadgeLeft: {
    left: responsiveSize(4),
  },
  comboBadgeRight: {
    right: responsiveSize(4),
  },
  comboText: {
    fontWeight: '900',
    fontSize: responsiveFont(12),
    fontVariant: ['tabular-nums'],
  },
  multText: {
    color: 'rgba(255,255,255,0.85)',
    fontWeight: '800',
    fontSize: responsiveFont(10),
  },
});
