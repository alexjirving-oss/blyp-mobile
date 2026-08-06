/**
 * RocketCinema — ultimate orbital launch (Skia).
 * Ignition → exhaust → tracked ascent → streaks → sonic ring → glory.
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
import { ENERGY_ORANGE, TEAL, TEAL_LIGHT, INK } from '../giftMotionSystem';
import { dismissFade, gloryHold, hash01, impactPulse, makeParticles, smoothstep } from './cinemaHelpers';

function buildRocketPaths(cx, cy, scale = 1) {
  const body = Skia.Path.Make();
  body.moveTo(cx, cy - 52 * scale);
  body.lineTo(cx + 18 * scale, cy - 10 * scale);
  body.lineTo(cx + 14 * scale, cy + 28 * scale);
  body.lineTo(cx - 14 * scale, cy + 28 * scale);
  body.lineTo(cx - 18 * scale, cy - 10 * scale);
  body.close();

  const finL = Skia.Path.Make();
  finL.moveTo(cx - 14 * scale, cy + 8 * scale);
  finL.lineTo(cx - 34 * scale, cy + 32 * scale);
  finL.lineTo(cx - 12 * scale, cy + 26 * scale);
  finL.close();

  const finR = Skia.Path.Make();
  finR.moveTo(cx + 14 * scale, cy + 8 * scale);
  finR.lineTo(cx + 34 * scale, cy + 32 * scale);
  finR.lineTo(cx + 12 * scale, cy + 26 * scale);
  finR.close();

  return { body, finL, finR };
}

export default function RocketCinema({ width, height, progress, budget }) {
  const cx = width / 2;
  const cy = height * 0.58;
  const paths = useMemo(() => buildRocketPaths(cx, cy, 1), [cx, cy]);
  const count = Math.min(budget.cinemaParticles || 32, 48);
  const sparks = useMemo(() => makeParticles(count, 7), [count]);
  const stars = useMemo(() => makeParticles(Math.min(22, count), 19), [count]);

  const rootOpacity = useDerivedValue(() => dismissFade(progress.value));
  const vehicleTransform = useDerivedValue(() => {
    const t = progress.value;
    const lift = smoothstep(0.22, 0.75, t);
    const punch = impactPulse(t);
    const scale = 0.82 + smoothstep(0.05, 0.2, t) * 0.28 + punch * 0.1 - smoothstep(0.85, 1, t) * 0.12;
    return [{ translateY: -lift * height * 0.72 }, { scale }];
  });
  const flash = useDerivedValue(() => impactPulse(progress.value) * 0.8);
  const ringR = useDerivedValue(() => 36 + smoothstep(0.2, 0.55, progress.value) * 140);
  const ringOp = useDerivedValue(() => impactPulse(progress.value) * 0.9 + gloryHold(progress.value) * 0.22);
  const exhaustH = useDerivedValue(() => 48 + smoothstep(0.2, 0.7, progress.value) * (budget.tier === 'low' ? 110 : 200));
  const exhaustOp = useDerivedValue(() => smoothstep(0.18, 0.28, progress.value) * dismissFade(progress.value));
  const chromaX = useDerivedValue(() => (budget.chromatic ? impactPulse(progress.value) * 4.5 : 0));
  const chromaL = useDerivedValue(() => [{ translateX: -chromaX.value }]);
  const chromaR = useDerivedValue(() => [{ translateX: chromaX.value }]);
  const bloomOp = useDerivedValue(() => gloryHold(progress.value) * 0.45 + impactPulse(progress.value) * 0.35);

  const w = budget.tier === 'low' ? 36 : 54;

  return (
    <Canvas style={{ width, height }}>
      <Group opacity={rootOpacity}>
        <RoundedRect x={0} y={0} width={width} height={height} color={INK} />
        <Circle cx={cx} cy={height * 0.78} r={width * 0.6}>
          <RadialGradient
            c={vec(cx, height * 0.78)}
            r={width * 0.6}
            colors={['#0B3D4A99', '#0B122000']}
          />
        </Circle>

        {stars.map((s) => (
          <StarStreak
            key={`st-${s.i}`}
            x={20 + hash01(s.i, 3) * (width - 40)}
            y0={hash01(s.i, 5) * height}
            progress={progress}
            length={16 + s.s * 36}
            baseOp={0.3 + s.r * 0.45}
          />
        ))}

        <Group transform={vehicleTransform} origin={vec(cx, cy)}>
          <Group opacity={exhaustOp}>
            <RoundedRect x={cx - w / 2} y={cy + 34} width={w} height={exhaustH} r={w / 2}>
              <LinearGradient
                start={vec(cx, cy + 34)}
                end={vec(cx, cy + 250)}
                colors={[`${ENERGY_ORANGE}EE`, `${TEAL}88`, '#00000000']}
              />
            </RoundedRect>
            <RoundedRect x={cx - 9} y={cy + 34} width={18} height={exhaustH} r={9}>
              <LinearGradient
                start={vec(cx, cy + 34)}
                end={vec(cx, cy + 200)}
                colors={['#FFF7ED', `${ENERGY_ORANGE}CC`, '#00000000']}
              />
            </RoundedRect>
          </Group>

          {budget.chromatic ? (
            <Group opacity={0.4} transform={chromaL}>
              <Path path={paths.body} color="#22D3EE99" />
            </Group>
          ) : null}
          {budget.chromatic ? (
            <Group opacity={0.35} transform={chromaR}>
              <Path path={paths.body} color="#FB718599" />
            </Group>
          ) : null}

          <Path path={paths.finL} color="#0E7490" />
          <Path path={paths.finR} color="#0E7490" />
          <Path path={paths.body}>
            <LinearGradient
              start={vec(cx - 20, cy - 50)}
              end={vec(cx + 20, cy + 30)}
              colors={[TEAL_LIGHT, TEAL, '#087F78']}
            />
          </Path>
          <Circle cx={cx} cy={cy - 12} r={7} color="#E0F7FA" />
          <Circle cx={cx} cy={cy - 12} r={4} color="#082F49" />
          <RoundedRect x={cx - 6} y={cy + 18} width={12} height={14} r={3} color={ENERGY_ORANGE} />

          {sparks.map((p) => (
            <Spark key={`sp-${p.i}`} cx={cx} cy={cy + 40} particle={p} progress={progress} />
          ))}
        </Group>

        <Circle
          cx={cx}
          cy={height * 0.4}
          r={ringR}
          style="stroke"
          strokeWidth={3}
          color={TEAL_LIGHT}
          opacity={ringOp}
        />

        {budget.bloom ? (
          <Group opacity={bloomOp}>
            <Circle cx={cx} cy={height * 0.52} r={100}>
              <RadialGradient
                c={vec(cx, height * 0.52)}
                r={100}
                colors={[`${ENERGY_ORANGE}AA`, '#00000000']}
              />
              <Blur blur={16} />
            </Circle>
          </Group>
        ) : null}

        <RoundedRect x={0} y={0} width={width} height={height} color="#FFFFFF" opacity={flash} />
      </Group>
    </Canvas>
  );
}

function StarStreak({ x, y0, progress, length, baseOp }) {
  const y = useDerivedValue(() => y0 + smoothstep(0.25, 0.9, progress.value) * 200);
  const op = useDerivedValue(
    () => baseOp * smoothstep(0.15, 0.35, progress.value) * dismissFade(progress.value)
  );
  return <RoundedRect x={x} y={y} width={1.6} height={length} r={1} color="#E0F2FE" opacity={op} />;
}

function Spark({ cx, cy, particle, progress }) {
  const x = useDerivedValue(() => {
    const t = Math.max(0, progress.value - particle.delay);
    const boom = smoothstep(0.2, 0.55, t);
    return cx + Math.cos(particle.a) * particle.r * 110 * boom;
  });
  const y = useDerivedValue(() => {
    const t = Math.max(0, progress.value - particle.delay);
    const boom = smoothstep(0.2, 0.55, t);
    return cy + Math.sin(particle.a) * particle.r * 90 * boom + boom * boom * 48;
  });
  const op = useDerivedValue(() => {
    const t = Math.max(0, progress.value - particle.delay);
    return smoothstep(0.18, 0.3, t) * (1 - smoothstep(0.55, 0.85, t)) * dismissFade(progress.value);
  });
  const color = particle.hue > 0.55 ? ENERGY_ORANGE : TEAL_LIGHT;
  return <Circle cx={x} cy={y} r={1.6 + particle.s * 2} color={color} opacity={op} />;
}
