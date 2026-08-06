/**
 * DiamondCinema — epic crystal prism with caustics and shard burst.
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
import { CRYSTAL, TEAL, TEAL_LIGHT } from '../giftMotionSystem';
import { dismissFade, gloryHold, impactPulse, makeParticles, smoothstep } from './cinemaHelpers';

function buildDiamond(cx, cy) {
  const gem = Skia.Path.Make();
  gem.moveTo(cx, cy - 58);
  gem.lineTo(cx + 42, cy - 8);
  gem.lineTo(cx + 28, cy + 48);
  gem.lineTo(cx - 28, cy + 48);
  gem.lineTo(cx - 42, cy - 8);
  gem.close();
  const facet = Skia.Path.Make();
  facet.moveTo(cx, cy - 58);
  facet.lineTo(cx + 18, cy - 4);
  facet.lineTo(cx, cy + 20);
  facet.lineTo(cx - 18, cy - 4);
  facet.close();
  return { gem, facet };
}

export default function DiamondCinema({ width, height, progress, budget }) {
  const cx = width / 2;
  const cy = height * 0.44;
  const { gem, facet } = useMemo(() => buildDiamond(cx, cy), [cx, cy]);
  const shards = useMemo(() => makeParticles(Math.min(budget.cinemaParticles || 32, 44), 23), [budget.cinemaParticles]);
  const beams = useMemo(() => Array.from({ length: budget.tier === 'low' ? 4 : 6 }, (_, i) => i), [budget.tier]);

  const rootOpacity = useDerivedValue(() => dismissFade(progress.value));
  const spin = useDerivedValue(() => {
    const t = progress.value;
    return smoothstep(0.05, 0.7, t) * Math.PI * 1.25 + impactPulse(t) * 0.15;
  });
  const transform = useDerivedValue(() => {
    const punch = impactPulse(progress.value);
    const scale = 0.55 + smoothstep(0.04, 0.22, progress.value) * 0.55 + punch * 0.12;
    return [{ rotate: spin.value }, { scale }];
  });
  const flash = useDerivedValue(() => impactPulse(progress.value) * 0.75);
  const causticOp = useDerivedValue(() => smoothstep(0.2, 0.4, progress.value) * gloryHold(progress.value) * 0.7 + 0.2);
  const bloomOp = useDerivedValue(() => gloryHold(progress.value) * 0.5 + impactPulse(progress.value) * 0.35);

  return (
    <Canvas style={{ width, height }}>
      <Group opacity={rootOpacity}>
        <RoundedRect x={0} y={0} width={width} height={height} color="#041018" />
        <Circle cx={cx} cy={cy} r={width * 0.4}>
          <RadialGradient c={vec(cx, cy)} r={width * 0.4} colors={['#083344AA', '#00000000']} />
        </Circle>

        {/* Prismatic beams */}
        <Group origin={vec(cx, cy)} opacity={causticOp} transform={transform}>
          {beams.map((i) => {
            const colors = [
              ['#67E8F9AA', '#00000000'],
              ['#A5F3FCAA', '#00000000'],
              ['#5EEAD4AA', '#00000000'],
              ['#22D3EEAA', '#00000000'],
              ['#99F6E4AA', '#00000000'],
              ['#E0F2FEAA', '#00000000'],
            ][i % 6];
            const ang = (i / beams.length) * Math.PI;
            return (
              <Group key={`beam-${i}`} transform={[{ rotate: ang }]} origin={vec(cx, cy)}>
                <RoundedRect x={cx - 8} y={cy - height * 0.35} width={16} height={height * 0.7} color={colors[0]} />
              </Group>
            );
          })}
        </Group>

        <Group transform={transform} origin={vec(cx, cy)}>
          <Path path={gem}>
            <LinearGradient
              start={vec(cx - 40, cy - 50)}
              end={vec(cx + 40, cy + 50)}
              colors={[CRYSTAL, TEAL_LIGHT, '#0E7490', TEAL]}
            />
          </Path>
          <Path path={facet} color="#FFFFFF66" />
          <Circle cx={cx - 10} cy={cy - 18} r={6} color="#FFFFFF55" />
        </Group>

        {shards.map((s) => (
          <Shard key={`sh-${s.i}`} cx={cx} cy={cy} particle={s} progress={progress} />
        ))}

        {budget.bloom ? (
          <Group opacity={bloomOp}>
            <Circle cx={cx} cy={cy} r={110}>
              <RadialGradient c={vec(cx, cy)} r={110} colors={[`${CRYSTAL}99`, '#00000000']} />
              <Blur blur={18} />
            </Circle>
          </Group>
        ) : null}

        <RoundedRect x={0} y={0} width={width} height={height} color="#ECFEFF" opacity={flash} />
      </Group>
    </Canvas>
  );
}

function Shard({ cx, cy, particle, progress }) {
  const x = useDerivedValue(() => {
    const t = Math.max(0, progress.value - particle.delay * 0.6);
    const boom = smoothstep(0.22, 0.5, t);
    return cx + Math.cos(particle.a) * particle.r * 130 * boom;
  });
  const y = useDerivedValue(() => {
    const t = Math.max(0, progress.value - particle.delay * 0.6);
    const boom = smoothstep(0.22, 0.5, t);
    return cy + Math.sin(particle.a) * particle.r * 110 * boom + boom * boom * 30;
  });
  const op = useDerivedValue(() => {
    const t = Math.max(0, progress.value - particle.delay * 0.5);
    return smoothstep(0.2, 0.32, t) * (1 - smoothstep(0.55, 0.8, t)) * dismissFade(progress.value);
  });
  return (
    <Circle
      cx={x}
      cy={y}
      r={2 + particle.s * 2.5}
      color={particle.hue > 0.5 ? CRYSTAL : TEAL_LIGHT}
      opacity={op}
    />
  );
}
