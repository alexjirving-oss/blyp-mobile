/**
 * Compact branded Frenemies wheel glyph for hub / picker / open card.
 * Not a letter placeholder — readable 8-seg mark at small sizes.
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Circle, G, Path, Defs, LinearGradient, Stop } from 'react-native-svg';

const GOLD = '#F5C542';
const GOLD_SOFT = '#FDE68A';
const TEAL = '#00D2BE';
const TEAL_DEEP = '#0A6B62';
const INK = '#0A0A0C';
const ROSE = '#FB7185';

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

const SEG_FILLS = [TEAL_DEEP, '#124F48', '#163D36', TEAL_DEEP, '#1A3A2F', '#0E3D38', TEAL_DEEP, '#124F48'];

export default function FrenemiesWheelGlyph({ size = 44 }) {
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = size * 0.42;
  const rInner = size * 0.16;
  const segs = 8;
  const step = 360 / segs;

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Svg width={size} height={size}>
        <Defs>
          <LinearGradient id="feHub" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor={GOLD_SOFT} />
            <Stop offset="55%" stopColor={GOLD} />
            <Stop offset="100%" stopColor="#C9A227" />
          </LinearGradient>
        </Defs>
        <Circle cx={cx} cy={cy} r={rOuter + size * 0.06} fill={INK} stroke={GOLD} strokeWidth={size * 0.035} />
        <Circle
          cx={cx}
          cy={cy}
          r={rOuter + size * 0.02}
          fill="none"
          stroke="rgba(0,210,190,0.35)"
          strokeWidth={size * 0.02}
        />
        <G>
          {SEG_FILLS.map((fill, i) => (
            <Path
              key={i}
              d={wedge(cx, cy, rOuter, rInner, i * step, (i + 1) * step)}
              fill={fill}
              stroke="rgba(245,197,66,0.4)"
              strokeWidth={0.8}
            />
          ))}
        </G>
        <Circle cx={cx} cy={cy} r={rInner} fill="url(#feHub)" stroke={INK} strokeWidth={1.2} />
        <Circle cx={cx} cy={cy} r={rInner * 0.35} fill={INK} />
        {/* Right-side pointer cue */}
        <Path
          d={`M ${cx + rOuter + size * 0.02} ${cy} L ${cx + rOuter + size * 0.14} ${cy - size * 0.07} L ${
            cx + rOuter + size * 0.14
          } ${cy + size * 0.07} Z`}
          fill={ROSE}
          stroke={GOLD}
          strokeWidth={0.6}
        />
        <Circle cx={cx} cy={cy - rOuter * 0.55} r={size * 0.035} fill={TEAL} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
});
