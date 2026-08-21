import React, { useMemo, useCallback } from 'react';
import Svg, {
  Path,
  Circle,
  Ellipse,
  Rect,
  Line,
  G,
  Defs,
  LinearGradient as SvgGradient,
  Stop,
  Polyline,
  Text as SvgText,
} from 'react-native-svg';
import { WORLD, COLS, surfaceAt, terrainPath, UNIT_RADIUS } from './engine';

const TEAL = '#FF2D55';
const ROSE = '#FB7185';
const TEAM_COLORS = ['#FF2D55', '#60A5FA'];

/**
 * ArtilleryStage — the pure SVG battlefield scene.
 *
 * Presentational only: it renders whatever `state` (an engine MatchState) plus
 * the transient aim/animation props describe. Shared by the local practice
 * screen and the networked battle-stage screen so visuals never drift.
 */
export default function ArtilleryStage({
  state,
  width,
  height,
  activeUnitId = null,
  aimArrow = null,
  preview = null,
  trails = null,
  projectiles = null,
  explosion = null,
}) {
  const sx = useCallback((x) => (x / WORLD.width) * width, [width]);
  const sy = useCallback((y) => (y / WORLD.height) * height, [height]);

  const tPath = useMemo(() => terrainPath(state.terrain, width, height), [state.terrain, width, height]);
  const topPoints = useMemo(() => {
    const colW = width / (COLS - 1);
    return state.terrain.map((h, i) => `${(i * colW).toFixed(1)},${sy(h).toFixed(1)}`).join(' ');
  }, [state.terrain, width, sy]);

  return (
    <Svg width={width} height={height}>
      <Defs>
        <SvgGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#0A0F16" />
          <Stop offset="0.55" stopColor="#0C1F26" />
          <Stop offset="1" stopColor="#0F3036" />
        </SvgGradient>
        <SvgGradient id="ground" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#3aa856" />
          <Stop offset="0.12" stopColor="#2f7d44" />
          <Stop offset="1" stopColor="#1c4a2c" />
        </SvgGradient>
      </Defs>
      <Rect x={0} y={0} width={width} height={height} fill="url(#sky)" />
      {/* Blyp Pulse: soft teal horizon glow */}
      <Ellipse cx={width * 0.5} cy={height * 0.66} rx={width * 0.75} ry={height * 0.3} fill="#FF2D55" opacity={0.05} />
      {/* Blyp watermark */}
      <SvgText x={width * 0.5} y={height * 0.3} fill="#FFFFFF" opacity={0.05} fontSize={height * 0.12} fontWeight="bold" textAnchor="middle">
        blyp.
      </SvgText>
      {/* Sun + soft clouds */}
      <Circle cx={width * 0.83} cy={height * 0.15} r={height * 0.07} fill="#FCE9A6" opacity={0.18} />
      <Circle cx={width * 0.83} cy={height * 0.15} r={height * 0.042} fill="#FDE68A" opacity={0.85} />
      <G opacity={0.28}>
        <Ellipse cx={width * 0.24} cy={height * 0.22} rx={46} ry={17} fill="#E8F2FF" />
        <Ellipse cx={width * 0.33} cy={height * 0.19} rx={32} ry={15} fill="#E8F2FF" />
        <Ellipse cx={width * 0.55} cy={height * 0.11} rx={40} ry={15} fill="#E8F2FF" />
        <Ellipse cx={width * 0.62} cy={height * 0.13} rx={28} ry={12} fill="#E8F2FF" />
      </G>
      <Path d={tPath} fill="url(#ground)" />
      <Polyline points={topPoints} fill="none" stroke="#6BE89B" strokeWidth={2.5} opacity={0.9} />

      {/* Units */}
      {state.units.map((u) => {
        if (!u.alive) return null;
        const ux = sx(u.x);
        const groundY = sy(surfaceAt(state.terrain, u.x));
        const r = UNIT_RADIUS * (height / WORLD.height);
        const cy = groundY - r;
        const color = TEAM_COLORS[u.team];
        const isActive = activeUnitId != null && u.id === activeUnitId;
        const dir = u.team === 0 ? 1 : -1;
        const low = u.hp <= 30;
        const mouthY = cy + r * 0.42;
        const mouth = `M ${ux - r * 0.32} ${mouthY} Q ${ux} ${mouthY + (low ? -r * 0.3 : r * 0.4)} ${ux + r * 0.32} ${mouthY}`;
        return (
          <G key={u.id}>
            {isActive && state.status !== 'ended' ? (
              <G>
                <Circle cx={ux} cy={cy} r={r + 11} fill={TEAL} opacity={0.13} />
                <Circle cx={ux} cy={cy} r={r + 7} fill="none" stroke={TEAL} strokeWidth={1.5} opacity={0.5} />
                <Circle cx={ux} cy={cy} r={r + 5} fill="none" stroke="#fff" strokeWidth={2} opacity={0.9} />
              </G>
            ) : null}
            <Ellipse cx={ux} cy={groundY - 1} rx={r * 0.9} ry={r * 0.22} fill="rgba(0,0,0,0.25)" />
            <Circle cx={ux} cy={cy} r={r} fill={color} />
            <Circle cx={ux} cy={cy} r={r} fill="none" stroke="rgba(0,0,0,0.22)" strokeWidth={1.5} />
            <Path
              d={`M ${ux - r * 0.96} ${cy - r * 0.28} A ${r * 0.96} ${r * 0.96} 0 0 1 ${ux + r * 0.96} ${cy - r * 0.28} Z`}
              fill="rgba(0,0,0,0.32)"
            />
            <Line x1={ux - r * 0.96} y1={cy - r * 0.28} x2={ux + r * 0.96} y2={cy - r * 0.28} stroke="rgba(0,0,0,0.32)" strokeWidth={2} strokeLinecap="round" />
            <Circle cx={ux - r * 0.34} cy={cy + r * 0.02} r={r * 0.27} fill="#fff" />
            <Circle cx={ux + r * 0.34} cy={cy + r * 0.02} r={r * 0.27} fill="#fff" />
            <Circle cx={ux - r * 0.34 + dir * r * 0.1} cy={cy + r * 0.04} r={r * 0.14} fill="#0A0A0C" />
            <Circle cx={ux + r * 0.34 + dir * r * 0.1} cy={cy + r * 0.04} r={r * 0.14} fill="#0A0A0C" />
            <Path d={mouth} stroke="#0A0A0C" strokeWidth={1.7} fill="none" strokeLinecap="round" />
            <Rect x={ux - r} y={cy - r - 10} width={r * 2} height={3} rx={1.5} fill="rgba(255,255,255,0.25)" />
            <Rect
              x={ux - r}
              y={cy - r - 10}
              width={(r * 2 * u.hp) / 100}
              height={3}
              rx={1.5}
              fill={u.hp > 50 ? TEAL : u.hp > 25 ? '#F59E0B' : ROSE}
            />
          </G>
        );
      })}

      {/* Aim barrel (solid, length tracks power) */}
      {aimArrow ? (
        <Line x1={aimArrow.x1} y1={aimArrow.y1} x2={aimArrow.x2} y2={aimArrow.y2} stroke="#fff" strokeWidth={4} strokeLinecap="round" />
      ) : null}

      {/* Aim guide (short predicted arc) */}
      {preview
        ? preview.map((p, idx) =>
            idx % 2 === 0 ? <Circle key={`pv${idx}`} cx={sx(p.x)} cy={sy(p.y)} r={2.5} fill="rgba(255,255,255,0.7)" /> : null
          )
        : null}

      {/* Projectile trails */}
      {trails
        ? trails.map((tr, ti) =>
            tr.length > 1 ? (
              <Polyline key={`tr${ti}`} points={tr.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ')} fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth={2} />
            ) : null
          )
        : null}

      {/* Projectiles */}
      {projectiles
        ? projectiles.map((p, pi) => (p ? <Circle key={`pj${pi}`} cx={sx(p.x)} cy={sy(p.y)} r={5} fill="#fff" /> : null))
        : null}

      {/* Explosions (animated blast + shrapnel, one per crater) */}
      {explosion
        ? explosion.blasts.map((bl, bi) => {
            const bx = sx(bl.x);
            const by = sy(bl.y);
            const rPx = (bl.r * width) / WORLD.width;
            const t = explosion.t;
            const spread = rPx * 1.5;
            return (
              <G key={`bl${bi}`}>
                <Circle cx={bx} cy={by} r={rPx * (0.3 + 1.05 * t)} fill="none" stroke="#FFFFFF" strokeWidth={Math.max(0.5, 3.5 * (1 - t))} opacity={(1 - t) * 0.85} />
                <Circle cx={bx} cy={by} r={rPx * (0.55 + 0.45 * t)} fill="#F59E0B" opacity={(1 - t) * 0.55} />
                <Circle cx={bx} cy={by} r={rPx * 0.6 * (1 - t * 0.6)} fill="#FCD34D" opacity={1 - t} />
                {bl.debris.map((d, idx) => (
                  <Rect
                    key={`db${idx}`}
                    x={bx + Math.cos(d.a) * d.s * spread * t * d.dir - d.size / 2}
                    y={by - Math.sin(d.a) * d.s * spread * t + 2.4 * spread * t * t - d.size / 2}
                    width={d.size}
                    height={d.size}
                    rx={1}
                    fill={d.color}
                    opacity={1 - t}
                  />
                ))}
              </G>
            );
          })
        : null}
    </Svg>
  );
}
