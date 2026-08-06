/**
 * CheerBurstCinema — stadium floodlights, energy ribbons, geometric confetti.
 */

import React, { useMemo } from 'react';
import {
  Canvas,
  Circle,
  Group,
  LinearGradient,
  RadialGradient,
  RoundedRect,
  vec,
  Blur,
} from '@shopify/react-native-skia';
import { useDerivedValue } from 'react-native-reanimated';
import { ENERGY_ORANGE, TEAL, TEAL_DARK, TEAL_LIGHT } from '../giftMotionSystem';
import { dismissFade, gloryHold, impactPulse, makeParticles, smoothstep } from './cinemaHelpers';

export default function CheerBurstCinema({ width, height, progress, budget }) {
  const cx = width / 2;
  const cy = height * 0.48;
  const confetti = useMemo(() => makeParticles(Math.min(budget.cinemaParticles || 32, 46), 31), [budget.cinemaParticles]);
  const ribbons = useMemo(() => [0, 1, 2, 3].slice(0, budget.tier === 'low' ? 2 : 4), [budget.tier]);

  const rootOpacity = useDerivedValue(() => dismissFade(progress.value));
  const flash = useDerivedValue(() => impactPulse(progress.value) * 0.65);
  const strobe = useDerivedValue(() => {
    const t = progress.value;
    const pulse = Math.sin(t * 40) * 0.5 + 0.5;
    return smoothstep(0.15, 0.35, t) * pulse * 0.55 * (1 - smoothstep(0.7, 0.9, t));
  });
  const waveX = useDerivedValue(() => (smoothstep(0.2, 0.65, progress.value) - 0.5) * width * 0.35);
  const coreScale = useDerivedValue(() => {
    const punch = impactPulse(progress.value);
    return 0.4 + smoothstep(0.08, 0.3, progress.value) * 0.7 + punch * 0.2;
  });
  const coreTransform = useDerivedValue(() => [{ scale: coreScale.value }]);
  const bloomOp = useDerivedValue(() => gloryHold(progress.value) * 0.45 + impactPulse(progress.value) * 0.3);

  return (
    <Canvas style={{ width, height }}>
      <Group opacity={rootOpacity}>
        <RoundedRect x={0} y={0} width={width} height={height} color="#071018" />

        {/* Floodlights */}
        <Circle cx={width * 0.18} cy={height * 0.12} r={90} opacity={strobe}>
          <RadialGradient c={vec(width * 0.18, height * 0.12)} r={90} colors={['#FFF7EDCC', '#00000000']} />
        </Circle>
        <Circle cx={width * 0.82} cy={height * 0.14} r={90} opacity={strobe}>
          <RadialGradient c={vec(width * 0.82, height * 0.14)} r={90} colors={[`${TEAL_LIGHT}BB`, '#00000000']} />
        </Circle>

        {/* Energy ribbons */}
        {ribbons.map((i) => (
          <Ribbon
            key={`rb-${i}`}
            y={cy - 50 + i * 36}
            width={width}
            progress={progress}
            shift={waveX}
            color={i % 2 === 0 ? TEAL : ENERGY_ORANGE}
            delay={i * 0.04}
          />
        ))}

        <Group transform={coreTransform} origin={vec(cx, cy)}>
          <Circle cx={cx} cy={cy} r={58}>
            <RadialGradient c={vec(cx, cy)} r={58} colors={[`${TEAL_LIGHT}EE`, `${TEAL}99`, `${TEAL_DARK}00`]} />
          </Circle>
          <Circle cx={cx} cy={cy} r={28} color={TEAL_LIGHT} opacity={0.85} />
          <Circle cx={cx} cy={cy} r={14} color="#ECFEFF" />
        </Group>

        {confetti.map((p) => (
          <ConfettiBit key={`cf-${p.i}`} cx={cx} cy={cy} particle={p} progress={progress} width={width} />
        ))}

        {budget.bloom ? (
          <Group opacity={bloomOp}>
            <Circle cx={cx} cy={cy} r={130}>
              <RadialGradient c={vec(cx, cy)} r={130} colors={[`${TEAL}88`, '#00000000']} />
              <Blur blur={16} />
            </Circle>
          </Group>
        ) : null}

        <RoundedRect x={0} y={0} width={width} height={height} color="#FFFFFF" opacity={flash} />
      </Group>
    </Canvas>
  );
}

function Ribbon({ y, width, progress, shift, color, delay }) {
  const op = useDerivedValue(() => {
    const t = Math.max(0, progress.value - delay);
    return smoothstep(0.15, 0.3, t) * (1 - smoothstep(0.75, 0.95, t)) * dismissFade(progress.value) * 0.75;
  });
  const x = useDerivedValue(() => shift.value - width * 0.15 + delay * 40);
  return (
    <RoundedRect x={x} y={y} width={width * 1.3} height={18} r={9} opacity={op}>
      <LinearGradient
        start={vec(0, y)}
        end={vec(width, y)}
        colors={['#00000000', `${color}CC`, `${ENERGY_ORANGE}88`, '#00000000']}
      />
    </RoundedRect>
  );
}

function ConfettiBit({ cx, cy, particle, progress, width }) {
  const x = useDerivedValue(() => {
    const t = Math.max(0, progress.value - particle.delay * 0.5);
    const boom = smoothstep(0.2, 0.55, t);
    return cx + Math.cos(particle.a) * particle.r * (width * 0.38) * boom;
  });
  const y = useDerivedValue(() => {
    const t = Math.max(0, progress.value - particle.delay * 0.5);
    const boom = smoothstep(0.2, 0.55, t);
    return cy + Math.sin(particle.a) * particle.r * 100 * boom + boom * boom * 70;
  });
  const op = useDerivedValue(() => {
    const t = Math.max(0, progress.value - particle.delay * 0.4);
    return smoothstep(0.18, 0.3, t) * (1 - smoothstep(0.6, 0.88, t)) * dismissFade(progress.value);
  });
  const color = particle.hue > 0.66 ? ENERGY_ORANGE : particle.hue > 0.33 ? TEAL_LIGHT : '#FDE68A';
  return <Circle cx={x} cy={y} r={2.2 + particle.s * 1.6} color={color} opacity={op} />;
}
