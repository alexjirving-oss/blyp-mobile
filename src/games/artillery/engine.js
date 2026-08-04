/**
 * Blyp Artillery — pure, deterministic game engine.
 *
 * Worms-style turn-based artillery. This module is intentionally PURE and
 * framework-free: no React, no native, no randomness outside the seeded RNG it
 * is given. That lets the exact same simulation run:
 *   - client-side now (for fast iteration / practice / arcade), and
 *   - server-side later (authoritative, anti-cheat) with identical results.
 *
 * Coordinate system: screen-style. x increases right, y increases DOWN.
 * Terrain is a height map of "surface y" per column (smaller y = taller ground).
 * Gravity pulls +y (down). Wind adds horizontal acceleration.
 */

export const WORLD = { width: 1000, height: 600 };
export const COLS = 140; // terrain resolution
const GRAVITY = 950; // world units / s^2
const DT = 1 / 60;
const MAX_STEPS = 1400; // hard cap on a shot's flight (~23s)
export const UNIT_RADIUS = 16;
const GROUND_MIN = 230; // highest possible ground surface (smaller y = higher)
const GROUND_MAX = 540; // lowest ground surface
export const WIND_MAX = 260;
const MIN_SPEED = 320;
const MAX_SPEED = 920;

/** Weapon catalog. `aimed` weapons use angle+power; crater/damage tune feel. */
export const WEAPONS = {
  bazooka: { id: 'bazooka', name: 'Blypzooka', icon: 'rocket', crater: 58, damage: 46, speed: 1.0, windFactor: 1.0, bounces: 0 },
  grenade: { id: 'grenade', name: 'Grenade', icon: 'egg', crater: 80, damage: 56, speed: 0.92, windFactor: 0.65, bounces: 2 },
  sheep: { id: 'sheep', name: 'Sheep', icon: 'paw', crater: 96, damage: 64, speed: 0.85, windFactor: 0.5, bounces: 1 },
  cluster: { id: 'cluster', name: 'Cluster', icon: 'apps', crater: 44, damage: 30, speed: 1.0, windFactor: 1.0, bounces: 0, spread: 3 },
  airstrike: { id: 'airstrike', name: 'Airstrike', icon: 'airplane', crater: 50, damage: 38, speed: 1.0, windFactor: 1.0, bounces: 0, bombs: 3 },
};

export const WEAPON_ORDER = ['bazooka', 'grenade', 'sheep', 'cluster', 'airstrike'];

// Tiny seeded RNG (mulberry32) so matches are reproducible + server-verifiable.
export function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth, hilly terrain from a seed (sum of a few sine waves + noise). */
export function createTerrain(seed) {
  const rng = makeRng(seed);
  const base = GROUND_MIN + (GROUND_MAX - GROUND_MIN) * (0.45 + rng() * 0.2);
  const waves = [
    { amp: 60 + rng() * 50, freq: 1 + rng() * 1.5, phase: rng() * Math.PI * 2 },
    { amp: 30 + rng() * 30, freq: 2.5 + rng() * 2, phase: rng() * Math.PI * 2 },
    { amp: 14 + rng() * 16, freq: 5 + rng() * 3, phase: rng() * Math.PI * 2 },
  ];
  const heights = new Array(COLS);
  for (let i = 0; i < COLS; i += 1) {
    const t = i / (COLS - 1);
    let y = base;
    for (const w of waves) y -= Math.sin(t * Math.PI * w.freq + w.phase) * w.amp;
    y += (rng() - 0.5) * 10;
    heights[i] = clamp(y, GROUND_MIN, GROUND_MAX);
  }
  return heights;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Interpolated ground surface y at world x. */
export function surfaceAt(terrain, x) {
  const fx = (clamp(x, 0, WORLD.width) / WORLD.width) * (COLS - 1);
  const i = Math.floor(fx);
  const j = Math.min(i + 1, COLS - 1);
  const f = fx - i;
  return terrain[i] * (1 - f) + terrain[j] * f;
}

function pickWind(rng) {
  return Math.round((rng() * 2 - 1) * WIND_MAX);
}

/**
 * Create a fresh match. Units are spread on each side; they sit on the terrain.
 */
export function createMatch({ seed = Date.now() & 0xffffffff, unitsPerTeam = 3, teamNames = ['You', 'Rival'] } = {}) {
  const terrain = createTerrain(seed);
  const rng = makeRng(seed ^ 0x9e3779b9);
  const units = [];
  let id = 1;
  for (let team = 0; team < 2; team += 1) {
    for (let k = 0; k < unitsPerTeam; k += 1) {
      // Team 0 occupies the left third, team 1 the right third.
      const span = WORLD.width * 0.3;
      const start = team === 0 ? WORLD.width * 0.06 : WORLD.width * 0.64;
      const x = start + (unitsPerTeam === 1 ? span / 2 : (span * k) / (unitsPerTeam - 1));
      units.push({ id: id++, team, x, hp: 100, alive: true });
    }
  }
  return {
    seed,
    terrain,
    units,
    teamNames,
    turnTeam: 0,
    wind: pickWind(rng),
    rngState: (seed ^ 0x12345) >>> 0,
    status: 'playing', // 'playing' | 'ended'
    winner: null,
    turnCount: 0,
    revivesUsed: [0, 0],
    lastOutcome: null,
  };
}

function nextWind(state) {
  const rng = makeRng(state.rngState);
  const w = pickWind(rng);
  return { wind: w, rngState: (state.rngState * 1664525 + 1013904223) >>> 0 };
}

function aliveUnits(state, team) {
  return state.units.filter((u) => u.alive && u.team === team);
}

/** Convert an aim (angle in degrees from horizontal, power 0..1) to velocity. */
export function aimVelocity(team, angleDeg, power) {
  const speed = MIN_SPEED + clamp(power, 0, 1) * (MAX_SPEED - MIN_SPEED);
  const rad = (clamp(angleDeg, 5, 85) * Math.PI) / 180;
  const dir = team === 0 ? 1 : -1; // team 0 fires right, team 1 fires left
  return { vx: Math.cos(rad) * speed * dir, vy: -Math.sin(rad) * speed };
}

/** Simulate a launched projectile arc (with optional bouncing). Pure. */
function flightArc(state, unit, weapon, angleDeg, power) {
  const v = aimVelocity(unit.team, angleDeg, power * weapon.speed);
  let x = unit.x;
  let y = surfaceAt(state.terrain, unit.x) - UNIT_RADIUS - 4;
  let vx = v.vx;
  let vy = v.vy;
  const wind = state.wind * weapon.windFactor;

  const trajectory = [{ x, y }];
  let impact = null;
  let bounces = weapon.bounces || 0;
  for (let step = 0; step < MAX_STEPS; step += 1) {
    vx += wind * DT;
    vy += GRAVITY * DT;
    x += vx * DT;
    y += vy * DT;
    if (step % 2 === 0) trajectory.push({ x, y });

    if (x < -40 || x > WORLD.width + 40 || y > WORLD.height + 200) {
      impact = { x, y, offMap: true };
      break;
    }
    const hitUnit = state.units.find(
      (u) => u.alive && u.id !== unit.id && Math.hypot(u.x - x, surfaceAt(state.terrain, u.x) - y) < UNIT_RADIUS + 6
    );
    if (hitUnit) {
      impact = { x, y, directHit: hitUnit.id };
      break;
    }
    if (y >= surfaceAt(state.terrain, x)) {
      if (bounces > 0) {
        y = surfaceAt(state.terrain, x) - 3;
        vy = -Math.abs(vy) * 0.55;
        vx *= 0.7;
        bounces -= 1;
        continue;
      }
      y = surfaceAt(state.terrain, x);
      impact = { x, y };
      break;
    }
  }
  if (!impact) impact = { x, y, offMap: true };
  trajectory.push({ x: impact.x, y: impact.y });
  return { trajectory, impact };
}

/** A bomb falling straight down from the sky onto targetX (airstrike). */
function dropArc(state, targetX) {
  let x = clamp(targetX, 0, WORLD.width);
  let y = 0;
  let vx = 0;
  let vy = 80;
  const wind = state.wind * 0.18;
  const trajectory = [{ x, y }];
  let impact = null;
  for (let step = 0; step < MAX_STEPS; step += 1) {
    vx += wind * DT;
    vy += GRAVITY * DT;
    x += vx * DT;
    y += vy * DT;
    if (step % 2 === 0) trajectory.push({ x, y });
    if (y >= surfaceAt(state.terrain, x)) {
      y = surfaceAt(state.terrain, x);
      impact = { x, y };
      break;
    }
    if (x < -40 || x > WORLD.width + 40) {
      impact = { x, y, offMap: true };
      break;
    }
  }
  if (!impact) impact = { x, y, offMap: true };
  trajectory.push({ x: impact.x, y: impact.y });
  return { trajectory, impact };
}

/** Sum blast damage from one or more blasts across all units. */
function computeDamage(state, weapon, blasts) {
  const total = new Map();
  for (const blast of blasts) {
    const reach = blast.crater + UNIT_RADIUS;
    for (const u of state.units) {
      if (!u.alive) continue;
      const uy = surfaceAt(state.terrain, u.x);
      const dist = Math.hypot(u.x - blast.x, uy - blast.y);
      if (dist <= reach) {
        const falloff = clamp(1 - dist / reach, 0, 1);
        const dmg = Math.round(weapon.damage * (0.4 + 0.6 * falloff) + (blast.directHit === u.id ? 18 : 0));
        total.set(u.id, (total.get(u.id) || 0) + dmg);
      }
    }
  }
  const damaged = [];
  const eliminated = [];
  for (const [unitId, dmg] of total) {
    damaged.push({ unitId, dmg });
    const u = state.units.find((x) => x.id === unitId);
    if (u && u.hp - dmg <= 0) eliminated.push(unitId);
  }
  return { damaged, eliminated };
}

/** Short aim arc used for the on-screen aiming guide (all weapons). */
export function aimArc(state, { unitId, weaponId, angleDeg, power }) {
  const unit = state.units.find((u) => u.id === unitId);
  const weapon = WEAPONS[weaponId] || WEAPONS.bazooka;
  if (!unit || !unit.alive) return null;
  return flightArc(state, unit, weapon, angleDeg, power).trajectory;
}

/**
 * Simulate a shot. Returns an immutable outcome with one or more projectile
 * trajectories and one or more blasts — but does NOT mutate state.
 */
export function simulateShot(state, { unitId, weaponId, angleDeg, power }) {
  const unit = state.units.find((u) => u.id === unitId);
  const weapon = WEAPONS[weaponId] || WEAPONS.bazooka;
  if (!unit || !unit.alive) return null;

  const trajectories = [];
  const blasts = [];

  if (weapon.bombs) {
    // Airstrike: a lead arc picks the target, then bombs rain straight down.
    const lead = flightArc(state, unit, weapon, angleDeg, power);
    const baseX = clamp(lead.impact.x, 70, WORLD.width - 70);
    const n = weapon.bombs;
    const spacing = 70;
    for (let b = 0; b < n; b += 1) {
      const tx = clamp(baseX + (b - (n - 1) / 2) * spacing, 20, WORLD.width - 20);
      const drop = dropArc(state, tx);
      trajectories.push(drop.trajectory);
      if (!drop.impact.offMap) blasts.push({ x: drop.impact.x, y: drop.impact.y, crater: weapon.crater });
    }
  } else {
    const arc = flightArc(state, unit, weapon, angleDeg, power);
    trajectories.push(arc.trajectory);
    if (!arc.impact.offMap) {
      const n = weapon.spread || 1;
      if (n > 1) {
        // Cluster: a fan of craters around the impact.
        const spacing = 56;
        for (let b = 0; b < n; b += 1) {
          const tx = clamp(arc.impact.x + (b - (n - 1) / 2) * spacing, 0, WORLD.width);
          blasts.push({ x: tx, y: surfaceAt(state.terrain, tx), crater: weapon.crater });
        }
      } else {
        blasts.push({ x: arc.impact.x, y: arc.impact.y, crater: weapon.crater, directHit: arc.impact.directHit });
      }
    }
  }

  const { damaged, eliminated } = computeDamage(state, weapon, blasts);
  const primary = blasts[0];

  return {
    unitId,
    weaponId: weapon.id,
    team: unit.team,
    trajectories,
    trajectory: trajectories[0], // back-compat
    blasts,
    impact: primary ? { x: primary.x, y: primary.y, directHit: primary.directHit } : { offMap: true },
    crater: weapon.crater, // back-compat
    damaged,
    eliminated,
  };
}

/** Carve a circular crater into the terrain height map (returns new array). */
function carveCrater(terrain, cx, cy, r) {
  const next = terrain.slice();
  const colW = WORLD.width / (COLS - 1);
  const minCol = Math.max(0, Math.floor((cx - r) / colW));
  const maxCol = Math.min(COLS - 1, Math.ceil((cx + r) / colW));
  for (let i = minCol; i <= maxCol; i += 1) {
    const colX = i * colW;
    const dx = colX - cx;
    if (Math.abs(dx) > r) continue;
    const depth = Math.sqrt(r * r - dx * dx);
    // Removing ground lowers the surface (surfaceY increases) down to crater floor.
    const floor = cy + depth;
    if (floor > next[i]) next[i] = clamp(floor, GROUND_MIN, GROUND_MAX);
  }
  return next;
}

/** Apply an outcome: deform terrain, damage units, advance the turn. */
export function applyOutcome(state, outcome) {
  if (!outcome) return state;
  let terrain = state.terrain;
  const blasts =
    outcome.blasts ||
    (outcome.impact && !outcome.impact.offMap
      ? [{ x: outcome.impact.x, y: outcome.impact.y, crater: outcome.crater }]
      : []);
  for (const b of blasts) terrain = carveCrater(terrain, b.x, b.y, b.crater);

  const dmgMap = new Map();
  for (const d of outcome.damaged) dmgMap.set(d.unitId, (dmgMap.get(d.unitId) || 0) + d.dmg);
  const units = state.units.map((u) => {
    if (!dmgMap.has(u.id)) return u;
    const hp = Math.max(0, u.hp - dmgMap.get(u.id));
    return { ...u, hp, alive: hp > 0 };
  });

  // Determine winner / next turn.
  const team0 = units.some((u) => u.alive && u.team === 0);
  const team1 = units.some((u) => u.alive && u.team === 1);
  let status = 'playing';
  let winner = null;
  if (!team0 || !team1) {
    status = 'ended';
    winner = !team0 && !team1 ? -1 : team0 ? 0 : 1;
  }
  const turnTeam = status === 'ended' ? state.turnTeam : state.turnTeam === 0 ? 1 : 0;
  const w = nextWind(state);

  return {
    ...state,
    terrain,
    units,
    status,
    winner,
    turnTeam,
    turnCount: state.turnCount + 1,
    wind: status === 'ended' ? state.wind : w.wind,
    rngState: w.rngState,
    lastOutcome: outcome,
  };
}

/**
 * Revive: bring one downed unit of `team` back (the gift mechanic).
 * Respawns at a clear spot on that team's side with partial hp. Honors a cap.
 */
export function reviveUnit(state, team, { cap = 5 } = {}) {
  if (state.status === 'ended') return state;
  if (state.revivesUsed[team] >= cap) return state;
  const down = state.units.find((u) => !u.alive && u.team === team);
  const revivesUsed = state.revivesUsed.slice();
  revivesUsed[team] += 1;
  let units;
  if (down) {
    units = state.units.map((u) => (u.id === down.id ? { ...u, alive: true, hp: 60 } : u));
  } else {
    // No downed unit: add a fresh one on that side.
    const span = WORLD.width * 0.3;
    const start = team === 0 ? WORLD.width * 0.06 : WORLD.width * 0.64;
    const x = start + span * (0.2 + Math.random() * 0.6);
    const id = state.units.reduce((m, u) => Math.max(m, u.id), 0) + 1;
    units = state.units.concat([{ id, team, x, hp: 60, alive: true }]);
  }
  return { ...state, units, revivesUsed };
}

/** Build an SVG path string for the terrain polygon (for rendering). */
export function terrainPath(terrain, width, height) {
  const colW = width / (COLS - 1);
  const sy = (y) => (y / WORLD.height) * height;
  let d = `M 0 ${height} L 0 ${sy(terrain[0])}`;
  for (let i = 0; i < COLS; i += 1) d += ` L ${(i * colW).toFixed(1)} ${sy(terrain[i]).toFixed(1)}`;
  d += ` L ${width} ${height} Z`;
  return d;
}
