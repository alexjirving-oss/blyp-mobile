/**
 * Compact branded Frenemies wheel glyph for hub / picker / open card.
 * Blyp stage palette: PETRONAS teal, ink dark, gold accents (match COLORS).
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Circle, G, Path, Defs, LinearGradient, Stop } from 'react-native-svg';

const TEAL = '#00D2BE';
const TEAL_DIM = '#00A89E';
const TEAL_DEEP = '#0A6B62';
const TEAL_INK = '#0B2F2C';
const GOLD = '#F5C542';
const GOLD_SOFT = '#FDE68A';
const GOLD_DARK = '#C9A227';
const INK = '#0A0A0C';
const ELECTRIC = '#67E8F9';

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

/** Alternating ink / deep-teal wedges — readable at 44–72px. */
const SEG_FILLS = [
  TEAL_INK,
  TEAL_DEEP,
  '#121216',
  TEAL_DEEP,
  TEAL_INK,
  '#0E4A44',
  '#121216',
  TEAL_DEEP,
];

export default function FrenemiesWheelGlyph({ size = 44 }) {
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = size * 0.4;
  const rInner = size * 0.17;
  const rBezel = rOuter + size * 0.055;
  const segs = 8;
  const step = 360 / segs;
  const uid = `feGlyph${Math.round(size)}`;

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Svg width={size} height={size}>
        <Defs>
          <LinearGradient id={`${uid}Hub`} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor={GOLD_SOFT} />
            <Stop offset="50%" stopColor={GOLD} />
            <Stop offset="100%" stopColor={GOLD_DARK} />
          </LinearGradient>
          <LinearGradient id={`${uid}Rim`} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor={TEAL} />
            <Stop offset="55%" stopColor={TEAL_DIM} />
            <Stop offset="100%" stopColor={GOLD_DARK} />
          </LinearGradient>
        </Defs>

        {/* Ink disc + teal/gold bezel */}
        <Circle cx={cx} cy={cy} r={rBezel} fill={INK} stroke={`url(#${uid}Rim)`} strokeWidth={size * 0.05} />
        <Circle
          cx={cx}
          cy={cy}
          r={rOuter + size * 0.012}
          fill="none"
          stroke="rgba(0,210,190,0.35)"
          strokeWidth={size * 0.018}
        />

        <G>
          {SEG_FILLS.map((fill, i) => (
            <Path
              key={i}
              d={wedge(cx, cy, rOuter, rInner, i * step, (i + 1) * step)}
              fill={fill}
              stroke="rgba(245,197,66,0.4)"
              strokeWidth={0.85}
            />
          ))}
        </G>

        {/* Gold hub (prize signal) */}
        <Circle cx={cx} cy={cy} r={rInner + size * 0.02} fill={INK} stroke={GOLD} strokeWidth={1.2} />
        <Circle cx={cx} cy={cy} r={rInner} fill={`url(#${uid}Hub)`} stroke={INK} strokeWidth={1.2} />
        <Circle cx={cx} cy={cy} r={rInner * 0.34} fill={INK} />
        <Circle cx={cx} cy={cy} r={rInner * 0.16} fill={TEAL} />

        {/* Right-side gold pointer */}
        <Path
          d={`M ${cx + rOuter + size * 0.01} ${cy} L ${cx + rOuter + size * 0.15} ${cy - size * 0.075} L ${
            cx + rOuter + size * 0.15
          } ${cy + size * 0.075} Z`}
          fill={GOLD}
          stroke={INK}
          strokeWidth={0.7}
        />
        {/* Teal stud at 12 o'clock — brand tick */}
        <Circle cx={cx} cy={cy - rOuter * 0.58} r={size * 0.035} fill={TEAL} stroke={ELECTRIC} strokeWidth={0.6} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
});
