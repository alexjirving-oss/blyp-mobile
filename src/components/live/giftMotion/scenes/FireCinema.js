/**
 * FireCinema — layered flame column, embers, heat shimmer, ash drift.
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
  Path,
  Skia,
} from '@shopify/react-native-skia';
import { useDerivedValue } from 'react-native-reanimated';
import { ENERGY_ORANGE, ENERGY_RED } from '../giftMotionSystem';
import { dismissFade, gloryHold, impactPulse, makeParticles, smoothstep } from './cinemaHelpers';

function buildFlame(cx, baseY, w, h) {
  const p = Skia.Path.Make();
  p.moveTo(cx - w * 0.5, baseY);
  p.cubicTo(cx - w * 0.7, baseY - h * 0.35, cx - w * 0.25, baseY - h * 0.55, cx - w * 0.15, baseY - h * 0.85);
  p.cubicTo(cx - w * 0.05, baseY - h * 1.05, cx + w * 0.05, baseY - h * 1.05, cx + w * 0.15, baseY - h * 0.85);
  p.cubicTo(cx + w * 0.25, baseY - h * 0.55, cx + w * 0.7, baseY - h * 0.35, cx + w * 0.5, baseY);
  p.close();
  return p;
}

export default function FireCinema({ width, height, progress, budget }) {
  const cx = width / 2;
  const baseY = height * 0.72;
  const outer = useMemo(() => buildFlame(cx, baseY, 110, 210), [cx, baseY]);
  const mid = useMemo(() => buildFlame(cx, baseY, 78, 175), [cx, baseY]);
  const core = useMemo(() => buildFlame(cx, baseY, 44, 130), [cx, baseY]);
  const embers = useMemo(() => makeParticles(Math.min(budget.cinemaParticles || 28, 40), 41), [budget.cinemaParticles]);

  const rootOpacity = useDerivedValue(() => dismissFade(progress.value));
  const rise = useDerivedValue(() => {
    const t = progress.value;
    const punch = impactPulse(t);
    return 0.55 + smoothstep(0.06, 0.28, t) * 0.55 + punch * 0.1 + Math.sin(t * 18) * 0.03;
  });
  const flameTransform = useDerivedValue(() => {
    const shimmer = Math.sin(progress.value * 22) * 0.04;
    return [{ scaleX: 1 + shimmer }, { scaleY: rise.value }, { translateY: (1 - rise.value) * 40 }];
  });
  const flash = useDerivedValue(() => impactPulse(progress.value) * 0.55);
  const glowOp = useDerivedValue(() => smoothstep(0.1, 0.3, progress.value) * gloryHold(progress.value) * 0.6 + 0.25);
  const bloomOp = useDerivedValue(() => gloryHold(progress.value) * 0.5);

  return (
    <Canvas style={{ width, height }}>
      <Group opacity={rootOpacity}>
        <RoundedRect x={0} y={0} width={width} height={height} color="#120805" />
        <Circle cx={cx} cy={baseY - 40} r={width * 0.45} opacity={glowOp}>
          <RadialGradient
            c={vec(cx, baseY - 40)}
            r={width * 0.45}
            colors={['#7C2D1266', '#00000000']}
          />
        </Circle>

        <Group transform={flameTransform} origin={vec(cx, baseY)}>
          <Path path={outer}>
            <LinearGradient
              start={vec(cx, baseY)}
              end={vec(cx, baseY - 220)}
              colors={['#7C2D12', ENERGY_RED, ENERGY_ORANGE, '#FDE68A00']}
            />
          </Path>
          <Path path={mid}>
            <LinearGradient
              start={vec(cx, baseY)}
              end={vec(cx, baseY - 180)}
              colors={[ENERGY_RED, ENERGY_ORANGE, '#FDBA74', '#FFF7ED88']}
            />
          </Path>
          <Path path={core}>
            <LinearGradient
              start={vec(cx, baseY)}
              end={vec(cx, baseY - 140)}
              colors={['#FDBA74', '#FFF7ED', '#FFFFFFCC']}
            />
          </Path>
        </Group>

        {embers.map((e) => (
          <Ember key={`em-${e.i}`} cx={cx} baseY={baseY} particle={e} progress={progress} />
        ))}

        {budget.bloom ? (
          <Group opacity={bloomOp}>
            <Circle cx={cx} cy={baseY - 80} r={100}>
              <RadialGradient c={vec(cx, baseY - 80)} r={100} colors={[`${ENERGY_ORANGE}99`, '#00000000']} />
              <Blur blur={18} />
            </Circle>
          </Group>
        ) : null}

        <RoundedRect x={0} y={0} width={width} height={height} color="#FFEDD5" opacity={flash} />
      </Group>
    </Canvas>
  );
}

function Ember({ cx, baseY, particle, progress }) {
  const x = useDerivedValue(() => {
    const t = Math.max(0, progress.value - particle.delay * 0.4);
    const rise = smoothstep(0.15, 0.85, t);
    return cx + Math.cos(particle.a) * particle.r * 50 + Math.sin(t * 12 + particle.a) * 12;
  });
  const y = useDerivedValue(() => {
    const t = Math.max(0, progress.value - particle.delay * 0.4);
    const rise = smoothstep(0.12, 0.9, t);
    return baseY - rise * (120 + particle.r * 140);
  });
  const op = useDerivedValue(() => {
    const t = Math.max(0, progress.value - particle.delay * 0.3);
    return smoothstep(0.12, 0.25, t) * (1 - smoothstep(0.65, 0.95, t)) * dismissFade(progress.value);
  });
  const color = particle.hue > 0.6 ? '#FDE68A' : particle.hue > 0.3 ? ENERGY_ORANGE : ENERGY_RED;
  return <Circle cx={x} cy={y} r={1.4 + particle.s * 1.8} color={color} opacity={op} />;
}
