/**
 * Compact branded Frenemies wheel glyph for hub / picker / open card.
 * Neon magenta + electric mint — unmistakably different from the teal mark.
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Circle, G, Path, Defs, LinearGradient, Stop } from 'react-native-svg';

const GOLD = '#FFE566';
const GOLD_SOFT = '#FFF1A8';
const TEAL = '#00F5D4';
const MAGENTA = '#FF2D95';
const MAGENTA_DEEP = '#8B1048';
const INK = '#050508';
const ELECTRIC = '#7CFFB2';

function polar(cx, cy, r, deg) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function wedge(cx, cy, rOuter, rInner, startDeg, endDeg) {
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

const SEG_FILLS = [
  MAGENTA_DEEP,
  '#5A0F3A',
  '#0E3D38',
  MAGENTA_DEEP,
  '#163D36',
  '#4A0A30',
  MAGENTA_DEEP,
  '#0A6B62',
];

export default function FrenemiesWheelGlyph({ size = 44 }) {
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = size * 0.42;
  const rInner = size * 0.18;
  const segs = 8;
  const step = 360 / segs;

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Svg width={size} height={size}>
        <Defs>
          <LinearGradient id="feHubNeon" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor={GOLD_SOFT} />
            <Stop offset="45%" stopColor={MAGENTA} />
            <Stop offset="100%" stopColor={TEAL} />
          </LinearGradient>
        </Defs>
        <Circle
          cx={cx}
          cy={cy}
          r={rOuter + size * 0.07}
          fill={INK}
          stroke={MAGENTA}
          strokeWidth={size * 0.045}
        />
        <Circle
          cx={cx}
          cy={cy}
          r={rOuter + size * 0.02}
          fill="none"
          stroke={ELECTRIC}
          strokeWidth={size * 0.025}
        />
        <G>
          {SEG_FILLS.map((fill, i) => (
            <Path
              key={i}
              d={wedge(cx, cy, rOuter, rInner, i * step, (i + 1) * step)}
              fill={fill}
              stroke="rgba(255,229,102,0.45)"
              strokeWidth={0.9}
            />
          ))}
        </G>
        <Circle cx={cx} cy={cy} r={rInner} fill="url(#feHubNeon)" stroke={INK} strokeWidth={1.4} />
        <Circle cx={cx} cy={cy} r={rInner * 0.32} fill={INK} />
        <Path
          d={`M ${cx + rOuter + size * 0.02} ${cy} L ${cx + rOuter + size * 0.16} ${cy - size * 0.08} L ${
            cx + rOuter + size * 0.16
          } ${cy + size * 0.08} Z`}
          fill={MAGENTA}
          stroke={GOLD}
          strokeWidth={0.7}
        />
        <Circle cx={cx} cy={cy - rOuter * 0.55} r={size * 0.04} fill={ELECTRIC} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
});
