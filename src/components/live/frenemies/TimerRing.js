/**
 * Circular countdown ring for Frenemies challenge / throw timers.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

const TEAL = '#00D2BE';
const GOLD = '#F5C542';
const ROSE = '#FB7185';
const TRACK = 'rgba(255,255,255,0.12)';

export default function TimerRing({
  endsAt,
  totalMs = 30_000,
  size = 72,
  stroke = 6,
  label,
  tone = 'gold', // gold | teal | rose
  nowTick = 0,
}) {
  void nowTick;
  const remaining = Math.max(0, (Date.parse(endsAt || '') || 0) - Date.now());
  const secs = Math.ceil(remaining / 1000);
  const pct = Math.max(0, Math.min(1, remaining / Math.max(1, totalMs)));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - pct);
  const color = tone === 'teal' ? TEAL : tone === 'rose' ? ROSE : GOLD;

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={TRACK}
          strokeWidth={stroke}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${c} ${c}`}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={styles.center}>
        <Text style={[styles.secs, { color }]} allowFontScaling={false}>
          {secs}
        </Text>
        {label ? (
          <Text style={styles.label} allowFontScaling={false}>
            {label}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  center: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secs: { fontWeight: '900', fontSize: 22, letterSpacing: 0.5 },
  label: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
    marginTop: -2,
    textTransform: 'uppercase',
  },
});
