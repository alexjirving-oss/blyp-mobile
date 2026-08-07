/**
 * Frenemies prize wheel — 11 visible segments, top pointer, ease-out land
 * on the authoritative server slot (targetSlot / landedSlot).
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import Svg, { G, Path, Circle, Defs, LinearGradient, Stop } from 'react-native-svg';

const TEAL_DEEP = '#0A6B62';
const GOLD = '#F5C542';
const GOLD_SOFT = '#FDE68A';
const INK = '#0A0A0C';
const ROSE = '#FB7185';

const SEG_COLORS = [
  '#0E3D38',
  '#124F48',
  '#0A6B62',
  '#0E3D38',
  '#1A3A2F',
  '#124F48',
  '#0A6B62',
  '#0E3D38',
  '#163D36',
  '#124F48',
  '#0A6B62',
];

function polar(cx, cy, r, deg) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function segmentPath(cx, cy, rOuter, rInner, startDeg, endDeg) {
  const large = endDeg - startDeg > 180 ? 1 : 0;
  const a0 = polar(cx, cy, rOuter, startDeg);
  const a1 = polar(cx, cy, rOuter, endDeg);
  const b1 = polar(cx, cy, rInner, endDeg);
  const b0 = polar(cx, cy, rInner, startDeg);
  return [
    `M ${a0.x} ${a0.y}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${a1.x} ${a1.y}`,
    `L ${b1.x} ${b1.y}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${b0.x} ${b0.y}`,
    'Z',
  ].join(' ');
}

/** Degrees to rotate so slot (1..n) center sits under the top pointer. */
export function landRotationForSlot(slot, maxSlots, extraSpins = 8) {
  const n = Math.max(1, maxSlots);
  const i = Math.max(1, Math.min(n, Number(slot) || 1)) - 1;
  const seg = 360 / n;
  const centerFromTop = (i + 0.5) * seg;
  return extraSpins * 360 - centerFromTop;
}

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

function spinsForDuration(ms) {
  const s = Math.max(0, ms) / 1000;
  if (s <= 8) return 4;
  if (s <= 20) return 6;
  if (s <= 40) return 9;
  return 12;
}

export default function PrizeWheel({
  size = 196,
  maxSlots = 11,
  phase,
  roundId,
  targetSlot,
  landedSlot,
  spinStartedAt,
  spinEndsAt,
  occupiedBySlot = {},
}) {
  const spinAnim = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  const slot = landedSlot || targetSlot;
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = size * 0.46;
  const rInner = size * 0.14;
  const seg = 360 / maxSlots;

  const segments = useMemo(() => {
    return Array.from({ length: maxSlots }, (_, i) => {
      const start = i * seg;
      const end = (i + 1) * seg;
      const mid = start + seg / 2;
      const labelPos = polar(cx, cy, rOuter * 0.72, mid);
      const n = i + 1;
      const guest = occupiedBySlot[n];
      return {
        n,
        path: segmentPath(cx, cy, rOuter, rInner, start, end),
        color: SEG_COLORS[i % SEG_COLORS.length],
        labelPos,
        occupied: !!guest,
      };
    });
  }, [maxSlots, seg, cx, cy, rOuter, rInner, occupiedBySlot]);

  useEffect(() => {
    if (phase !== 'spinning') {
      const land = landRotationForSlot(slot || 1, maxSlots, 0);
      spinAnim.setValue(land);
      return undefined;
    }

    const endMs = Date.parse(spinEndsAt || '') || Date.now() + 60_000;
    const startMs = Date.parse(spinStartedAt || '') || Date.now();
    const total = Math.max(1, endMs - startMs);
    const remaining = Math.max(120, endMs - Date.now());
    const elapsed = Math.max(0, Math.min(total, Date.now() - startMs));
    const progress = elapsed / total;

    const extra = spinsForDuration(total);
    const finalDeg = landRotationForSlot(targetSlot || slot || 1, maxSlots, extra);
    const fromDeg = easeOutCubic(progress) * finalDeg;
    spinAnim.setValue(fromDeg);

    const anim = Animated.timing(spinAnim, {
      toValue: finalDeg,
      duration: remaining,
      easing: Easing.bezier(0.12, 0.75, 0.18, 1),
      useNativeDriver: true,
    });
    anim.start();

    return () => anim.stop();
  }, [phase, roundId, targetSlot, slot, maxSlots, spinStartedAt, spinEndsAt, spinAnim]);

  useEffect(() => {
    if (phase !== 'spinning') {
      pulse.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [phase, pulse]);

  const rotate = spinAnim.interpolate({
    inputRange: [-7200, 7200],
    outputRange: ['-7200deg', '7200deg'],
  });

  const glowScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.045] });

  return (
    <View style={[styles.wrap, { width: size + 8, height: size + 28 }]}>
      <View style={styles.pointerWrap} pointerEvents="none">
        <View style={styles.pointer} />
      </View>

      <Animated.View
        style={[
          styles.wheelStage,
          { width: size, height: size, transform: [{ scale: glowScale }, { rotate }] },
        ]}
      >
        <View
          style={[
            styles.glow,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
            },
          ]}
        />
        <Svg width={size} height={size}>
          <Defs>
            <LinearGradient id="hubGold" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0%" stopColor={GOLD_SOFT} />
              <Stop offset="100%" stopColor={GOLD} />
            </LinearGradient>
          </Defs>
          <Circle cx={cx} cy={cy} r={rOuter + 3} fill={INK} stroke={GOLD} strokeWidth={3} />
          <G>
            {segments.map((s) => (
              <Path
                key={s.n}
                d={s.path}
                fill={s.occupied ? TEAL_DEEP : s.color}
                stroke="rgba(245,197,66,0.35)"
                strokeWidth={1}
              />
            ))}
          </G>
          <Circle cx={cx} cy={cy} r={rInner} fill="url(#hubGold)" stroke={INK} strokeWidth={2} />
        </Svg>
        <View style={[StyleSheet.absoluteFillObject, { width: size, height: size }]} pointerEvents="none">
          {segments.map((s) => (
            <View
              key={`t-${s.n}`}
              style={[
                styles.segLabel,
                {
                  left: s.labelPos.x - 12,
                  top: s.labelPos.y - 12,
                },
              ]}
            >
              <Text style={[styles.segNum, s.occupied && styles.segNumHot]} allowFontScaling={false}>
                {s.n}
              </Text>
            </View>
          ))}
          <View style={[styles.hubLabel, { left: cx - 22, top: cy - 10, width: 44 }]}>
            <Text style={styles.hubText} allowFontScaling={false}>
              SPIN
            </Text>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 10,
  },
  pointerWrap: {
    position: 'absolute',
    top: 0,
    zIndex: 6,
    alignItems: 'center',
  },
  pointer: {
    width: 0,
    height: 0,
    borderLeftWidth: 11,
    borderRightWidth: 11,
    borderTopWidth: 20,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: ROSE,
    // Drop shadow via twin
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  wheelStage: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    backgroundColor: 'rgba(0,210,190,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(0,210,190,0.35)',
  },
  segLabel: {
    position: 'absolute',
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segNum: {
    color: GOLD_SOFT,
    fontWeight: '900',
    fontSize: 12,
    letterSpacing: 0.3,
    textShadowColor: 'rgba(0,0,0,0.65)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  segNumHot: {
    color: '#fff',
    fontSize: 13,
  },
  hubLabel: {
    position: 'absolute',
    alignItems: 'center',
  },
  hubText: {
    color: INK,
    fontWeight: '900',
    fontSize: 11,
    letterSpacing: 1.2,
  },
});
