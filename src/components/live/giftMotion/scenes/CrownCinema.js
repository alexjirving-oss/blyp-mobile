/**
 * CrownCinema — legendary regal drop with god-rays and gold facets.
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
import { GOLD, TEAL, TEAL_LIGHT } from '../giftMotionSystem';
import { dismissFade, gloryHold, impactPulse, makeParticles, smoothstep } from './cinemaHelpers';

function buildCrown(cx, cy) {
  const p = Skia.Path.Make();
  p.moveTo(cx - 54, cy + 18);
  p.lineTo(cx - 48, cy - 8);
  p.lineTo(cx - 28, cy + 6);
  p.lineTo(cx - 16, cy - 28);
  p.lineTo(cx, cy + 2);
  p.lineTo(cx + 16, cy - 28);
  p.lineTo(cx + 28, cy + 6);
  p.lineTo(cx + 48, cy - 8);
  p.lineTo(cx + 54, cy + 18);
  p.close();
  return p;
}

export default function CrownCinema({ width, height, progress, budget }) {
  const cx = width / 2;
  const cy = height * 0.42;
  const crownPath = useMemo(() => buildCrown(cx, cy), [cx, cy]);
  const sparks = useMemo(() => makeParticles(Math.min(budget.cinemaParticles || 28, 40), 11), [budget.cinemaParticles]);

  const rootOpacity = useDerivedValue(() => dismissFade(progress.value));
  const drop = useDerivedValue(() => {
    const t = progress.value;
    const enter = 1 - smoothstep(0.04, 0.2, t);
    const settle = impactPulse(t) * -8;
    return -height * 0.28 * enter + settle;
  });
  const transform = useDerivedValue(() => {
    const punch = impactPulse(progress.value);
    const rot = (1 - smoothstep(0.05, 0.35, progress.value)) * -12 + punch * 3;
    const scale = 0.7 + smoothstep(0.05, 0.22, progress.value) * 0.38 + punch * 0.08;
    return [{ translateY: drop.value }, { rotate: (rot * Math.PI) / 180 }, { scale }];
  });
  const flash = useDerivedValue(() => impactPulse(progress.value) * 0.7);
  const rayOp = useDerivedValue(() => smoothstep(0.08, 0.25, progress.value) * gloryHold(progress.value) * 0.55 + smoothstep(0.1, 0.3, progress.value) * 0.35);
  const pedestalOp = useDerivedValue(() => smoothstep(0.25, 0.4, progress.value) * dismissFade(progress.value));
  const bloomOp = useDerivedValue(() => gloryHold(progress.value) * 0.55);

  const rays = useMemo(() => Array.from({ length: budget.tier === 'low' ? 5 : 8 }, (_, i) => i), [budget.tier]);

  return (
    <Canvas style={{ width, height }}>
      <Group opacity={rootOpacity}>
        <RoundedRect x={0} y={0} width={width} height={height} color="#0A0F14" />
        <Circle cx={cx} cy={cy + 20} r={width * 0.42}>
          <RadialGradient
            c={vec(cx, cy + 20)}
            r={width * 0.42}
            colors={['#1A140899', '#00000000']}
          />
        </Circle>

        {/* God rays */}
        <Group origin={vec(cx, cy - 40)} opacity={rayOp}>
          {rays.map((i) => {
            const ang = -50 + i * (100 / Math.max(1, rays.length - 1));
            return (
              <Group key={`ray-${i}`} transform={[{ rotate: (ang * Math.PI) / 180 }]} origin={vec(cx, cy - 40)}>
                <RoundedRect x={cx - 6} y={cy - 40} width={12} height={height * 0.55} color={`${GOLD}33`} />
              </Group>
            );
          })}
        </Group>

        <Group opacity={pedestalOp}>
          <Circle cx={cx} cy={cy + 78} r={70}>
            <RadialGradient c={vec(cx, cy + 78)} r={70} colors={[`${TEAL}66`, '#00000000']} />
          </Circle>
          <RoundedRect x={cx - 48} y={cy + 70} width={96} height={10} r={5} color={`${GOLD}AA`} />
        </Group>

        <Group transform={transform} origin={vec(cx, cy)}>
          <Path path={crownPath}>
            <LinearGradient
              start={vec(cx - 50, cy - 30)}
              end={vec(cx + 50, cy + 20)}
              colors={['#FEF3C7', GOLD, '#B45309']}
            />
          </Path>
          <RoundedRect x={cx - 56} y={cy + 16} width={112} height={16} r={3} color="#F59E0B" />
          <Circle cx={cx} cy={cy - 4} r={5} color={TEAL_LIGHT} />
          <Circle cx={cx - 30} cy={cy + 2} r={3.5} color={TEAL} />
          <Circle cx={cx + 30} cy={cy + 2} r={3.5} color={TEAL} />
        </Group>

        {sparks.map((sp) => (
          <Sparkle key={`sp-${sp.i}`} cx={cx} cy={cy} particle={sp} progress={progress} />
        ))}

        {budget.bloom ? (
          <Group opacity={bloomOp}>
            <Circle cx={cx} cy={cy} r={120}>
              <RadialGradient c={vec(cx, cy)} r={120} colors={[`${GOLD}88`, '#00000000']} />
              <Blur blur={20} />
            </Circle>
          </Group>
        ) : null}

        <RoundedRect x={0} y={0} width={width} height={height} color="#FFF7ED" opacity={flash} />
      </Group>
    </Canvas>
  );
}

function Sparkle({ cx, cy, particle, progress }) {
  const x = useDerivedValue(() => {
    const t = Math.max(0, progress.value - particle.delay * 0.5);
    const g = gloryHold(t) + impactPulse(t);
    return cx + Math.cos(particle.a) * (30 + particle.r * 90) * (0.3 + g);
  });
  const y = useDerivedValue(() => {
    const t = Math.max(0, progress.value - particle.delay * 0.5);
    const g = gloryHold(t) + impactPulse(t);
    return cy + Math.sin(particle.a) * (24 + particle.r * 70) * (0.3 + g) - smoothstep(0.3, 0.9, t) * 40;
  });
  const op = useDerivedValue(() => {
    const t = Math.max(0, progress.value - particle.delay * 0.4);
    return smoothstep(0.2, 0.35, t) * (1 - smoothstep(0.75, 0.95, t)) * dismissFade(progress.value);
  });
  return <Circle cx={x} cy={y} r={1.2 + particle.s} color={particle.hue > 0.5 ? GOLD : TEAL_LIGHT} opacity={op} />;
}
