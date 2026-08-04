/**
 * Blyp Artillery — server-authoritative deterministic engine (TypeScript port).
 *
 * This is a faithful port of the client engine at
 * `src/games/artillery/engine.js`. The simulation is PURE and framework-free so
 * the SERVER can run it authoritatively (anti-cheat): the server computes every
 * shot outcome and the resulting state, then broadcasts it; clients only render
 * what the server returns. The two engines must stay behaviourally in sync.
 *
 * Coordinate system: screen-style. x increases right, y increases DOWN.
 * Terrain is a height map of "surface y" per column (smaller y = taller ground).
 */

export const WORLD = { width: 1000, height: 600 };
export const COLS = 140; // terrain resolution
const GRAVITY = 950; // world units / s^2
const DT = 1 / 60;
const MAX_STEPS = 1400;
export const UNIT_RADIUS = 16;
const GROUND_MIN = 230;
const GROUND_MAX = 540;
export const WIND_MAX = 260;
const MIN_SPEED = 320;
const MAX_SPEED = 920;

export interface Vec {
  x: number;
  y: number;
}

export interface Unit {
  id: number;
  team: number;
  x: number;
  hp: number;
  alive: boolean;
}

export interface Weapon {
  id: string;
  name: string;
  icon: string;
  crater: number;
  damage: number;
  speed: number;
  windFactor: number;
  bounces: number;
  spread?: number;
  bombs?: number;
}

export interface Blast {
  x: number;
  y: number;
  crater: number;
  directHit?: number;
}

export interface Impact {
  x?: number;
  y?: number;
  offMap?: boolean;
  directHit?: number;
}

export interface Damage {
  unitId: number;
  dmg: number;
}

export interface Outcome {
  unitId: number;
  weaponId: string;
  team: number;
  trajectories: Vec[][];
  trajectory: Vec[];
  blasts: Blast[];
  impact: Impact;
  crater: number;
  damaged: Damage[];
  eliminated: number[];
}

export interface MatchState {
  seed: number;
  terrain: number[];
  units: Unit[];
  teamNames: string[];
  turnTeam: number;
  wind: number;
  rngState: number;
  status: 'playing' | 'ended';
  winner: number | null;
  turnCount: number;
  revivesUsed: number[];
  lastOutcome: Outcome | null;
}

export interface FireInput {
  unitId: number;
  weaponId: string;
  angleDeg: number;
  power: number;
}

export const WEAPONS: Record<string, Weapon> = {
  bazooka: { id: 'bazooka', name: 'Blypzooka', icon: 'rocket', crater: 58, damage: 46, speed: 1.0, windFactor: 1.0, bounces: 0 },
  grenade: { id: 'grenade', name: 'Grenade', icon: 'egg', crater: 80, damage: 56, speed: 0.92, windFactor: 0.65, bounces: 2 },
  sheep: { id: 'sheep', name: 'Sheep', icon: 'paw', crater: 96, damage: 64, speed: 0.85, windFactor: 0.5, bounces: 1 },
  cluster: { id: 'cluster', name: 'Cluster', icon: 'apps', crater: 44, damage: 30, speed: 1.0, windFactor: 1.0, bounces: 0, spread: 3 },
  airstrike: { id: 'airstrike', name: 'Airstrike', icon: 'airplane', crater: 50, damage: 38, speed: 1.0, windFactor: 1.0, bounces: 0, bombs: 3 },
};

export const WEAPON_ORDER = ['bazooka', 'grenade', 'sheep', 'cluster', 'airstrike'];

// Tiny seeded RNG (mulberry32) so matches are reproducible + server-verifiable.
export function makeRng(seed: number): () => number {
  let a = (seed >>> 0) || 1;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function createTerrain(seed: number): number[] {
  const rng = makeRng(seed);
  const base = GROUND_MIN + (GROUND_MAX - GROUND_MIN) * (0.45 + rng() * 0.2);
  const waves = [
    { amp: 60 + rng() * 50, freq: 1 + rng() * 1.5, phase: rng() * Math.PI * 2 },
    { amp: 30 + rng() * 30, freq: 2.5 + rng() * 2, phase: rng() * Math.PI * 2 },
    { amp: 14 + rng() * 16, freq: 5 + rng() * 3, phase: rng() * Math.PI * 2 },
  ];
  const heights = new Array<number>(COLS);
  for (let i = 0; i < COLS; i += 1) {
    const t = i / (COLS - 1);
    let y = base;
    for (const w of waves) y -= Math.sin(t * Math.PI * w.freq + w.phase) * w.amp;
    y += (rng() - 0.5) * 10;
    heights[i] = clamp(y, GROUND_MIN, GROUND_MAX);
  }
  return heights;
}

export function surfaceAt(terrain: number[], x: number): number {
  const fx = (clamp(x, 0, WORLD.width) / WORLD.width) * (COLS - 1);
  const i = Math.floor(fx);
  const j = Math.min(i + 1, COLS - 1);
  const f = fx - i;
  return terrain[i] * (1 - f) + terrain[j] * f;
}

function pickWind(rng: () => number): number {
  return Math.round((rng() * 2 - 1) * WIND_MAX);
}

export function createMatch(opts: { seed?: number; unitsPerTeam?: number; teamNames?: string[] } = {}): MatchState {
  const seed = opts.seed ?? (Date.now() & 0xffffffff);
  const unitsPerTeam = opts.unitsPerTeam ?? 3;
  const teamNames = opts.teamNames ?? ['You', 'Rival'];
  const terrain = createTerrain(seed);
  const rng = makeRng(seed ^ 0x9e3779b9);
  const units: Unit[] = [];
  let id = 1;
  for (let team = 0; team < 2; team += 1) {
    for (let k = 0; k < unitsPerTeam; k += 1) {
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
    status: 'playing',
    winner: null,
    turnCount: 0,
    revivesUsed: [0, 0],
    lastOutcome: null,
  };
}

function nextWind(state: MatchState): { wind: number; rngState: number } {
  const rng = makeRng(state.rngState);
  const w = pickWind(rng);
  return { wind: w, rngState: (state.rngState * 1664525 + 1013904223) >>> 0 };
}

export function aimVelocity(team: number, angleDeg: number, power: number): { vx: number; vy: number } {
  const speed = MIN_SPEED + clamp(power, 0, 1) * (MAX_SPEED - MIN_SPEED);
  const rad = (clamp(angleDeg, 5, 85) * Math.PI) / 180;
  const dir = team === 0 ? 1 : -1;
  return { vx: Math.cos(rad) * speed * dir, vy: -Math.sin(rad) * speed };
}

function flightArc(
  state: MatchState,
  unit: Unit,
  weapon: Weapon,
  angleDeg: number,
  power: number
): { trajectory: Vec[]; impact: Impact } {
  const v = aimVelocity(unit.team, angleDeg, power * weapon.speed);
  let x = unit.x;
  let y = surfaceAt(state.terrain, unit.x) - UNIT_RADIUS - 4;
  let vx = v.vx;
  let vy = v.vy;
  const wind = state.wind * weapon.windFactor;

  const trajectory: Vec[] = [{ x, y }];
  let impact: Impact | null = null;
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
  trajectory.push({ x: impact.x as number, y: impact.y as number });
  return { trajectory, impact };
}

function dropArc(state: MatchState, targetX: number): { trajectory: Vec[]; impact: Impact } {
  let x = clamp(targetX, 0, WORLD.width);
  let y = 0;
  let vx = 0;
  let vy = 80;
  const wind = state.wind * 0.18;
  const trajectory: Vec[] = [{ x, y }];
  let impact: Impact | null = null;
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
  trajectory.push({ x: impact.x as number, y: impact.y as number });
  return { trajectory, impact };
}

function computeDamage(state: MatchState, weapon: Weapon, blasts: Blast[]): { damaged: Damage[]; eliminated: number[] } {
  const total = new Map<number, number>();
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
  const damaged: Damage[] = [];
  const eliminated: number[] = [];
  for (const [unitId, dmg] of total) {
    damaged.push({ unitId, dmg });
    const u = state.units.find((x) => x.id === unitId);
    if (u && u.hp - dmg <= 0) eliminated.push(unitId);
  }
  return { damaged, eliminated };
}

export function simulateShot(state: MatchState, input: FireInput): Outcome | null {
  const { unitId, weaponId, angleDeg, power } = input;
  const unit = state.units.find((u) => u.id === unitId);
  const weapon = WEAPONS[weaponId] || WEAPONS.bazooka;
  if (!unit || !unit.alive) return null;

  const trajectories: Vec[][] = [];
  const blasts: Blast[] = [];

  if (weapon.bombs) {
    const lead = flightArc(state, unit, weapon, angleDeg, power);
    const baseX = clamp(lead.impact.x as number, 70, WORLD.width - 70);
    const n = weapon.bombs;
    const spacing = 70;
    for (let b = 0; b < n; b += 1) {
      const tx = clamp(baseX + (b - (n - 1) / 2) * spacing, 20, WORLD.width - 20);
      const drop = dropArc(state, tx);
      trajectories.push(drop.trajectory);
      if (!drop.impact.offMap) blasts.push({ x: drop.impact.x as number, y: drop.impact.y as number, crater: weapon.crater });
    }
  } else {
    const arc = flightArc(state, unit, weapon, angleDeg, power);
    trajectories.push(arc.trajectory);
    if (!arc.impact.offMap) {
      const n = weapon.spread || 1;
      if (n > 1) {
        const spacing = 56;
        for (let b = 0; b < n; b += 1) {
          const tx = clamp((arc.impact.x as number) + (b - (n - 1) / 2) * spacing, 0, WORLD.width);
          blasts.push({ x: tx, y: surfaceAt(state.terrain, tx), crater: weapon.crater });
        }
      } else {
        blasts.push({ x: arc.impact.x as number, y: arc.impact.y as number, crater: weapon.crater, directHit: arc.impact.directHit });
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
    trajectory: trajectories[0],
    blasts,
    impact: primary ? { x: primary.x, y: primary.y, directHit: primary.directHit } : { offMap: true },
    crater: weapon.crater,
    damaged,
    eliminated,
  };
}

function carveCrater(terrain: number[], cx: number, cy: number, r: number): number[] {
  const next = terrain.slice();
  const colW = WORLD.width / (COLS - 1);
  const minCol = Math.max(0, Math.floor((cx - r) / colW));
  const maxCol = Math.min(COLS - 1, Math.ceil((cx + r) / colW));
  for (let i = minCol; i <= maxCol; i += 1) {
    const colX = i * colW;
    const dx = colX - cx;
    if (Math.abs(dx) > r) continue;
    const depth = Math.sqrt(r * r - dx * dx);
    const floor = cy + depth;
    if (floor > next[i]) next[i] = clamp(floor, GROUND_MIN, GROUND_MAX);
  }
  return next;
}

export function applyOutcome(state: MatchState, outcome: Outcome | null): MatchState {
  if (!outcome) return state;
  let terrain = state.terrain;
  const blasts: Blast[] =
    outcome.blasts ||
    (outcome.impact && !outcome.impact.offMap
      ? [{ x: outcome.impact.x as number, y: outcome.impact.y as number, crater: outcome.crater }]
      : []);
  for (const b of blasts) terrain = carveCrater(terrain, b.x, b.y, b.crater);

  const dmgMap = new Map<number, number>();
  for (const d of outcome.damaged) dmgMap.set(d.unitId, (dmgMap.get(d.unitId) || 0) + d.dmg);
  const units = state.units.map((u) => {
    if (!dmgMap.has(u.id)) return u;
    const hp = Math.max(0, u.hp - (dmgMap.get(u.id) as number));
    return { ...u, hp, alive: hp > 0 };
  });

  const team0 = units.some((u) => u.alive && u.team === 0);
  const team1 = units.some((u) => u.alive && u.team === 1);
  let status: 'playing' | 'ended' = 'playing';
  let winner: number | null = null;
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
 * Revive: bring one downed unit of `team` back (the gift mechanic). Honors a cap.
 * Server uses the seeded RNG (not Math.random) so it stays deterministic.
 */
export function reviveUnit(state: MatchState, team: number, opts: { cap?: number } = {}): MatchState {
  const cap = opts.cap ?? 5;
  if (state.status === 'ended') return state;
  if (state.revivesUsed[team] >= cap) return state;
  const down = state.units.find((u) => !u.alive && u.team === team);
  const revivesUsed = state.revivesUsed.slice();
  revivesUsed[team] += 1;
  let units: Unit[];
  let rngState = state.rngState;
  if (down) {
    units = state.units.map((u) => (u.id === down.id ? { ...u, alive: true, hp: 60 } : u));
  } else {
    const rng = makeRng(state.rngState);
    const span = WORLD.width * 0.3;
    const start = team === 0 ? WORLD.width * 0.06 : WORLD.width * 0.64;
    const x = start + span * (0.2 + rng() * 0.6);
    const id = state.units.reduce((m, u) => Math.max(m, u.id), 0) + 1;
    units = state.units.concat([{ id, team, x, hp: 60, alive: true }]);
    rngState = (state.rngState * 1664525 + 1013904223) >>> 0;
  }
  return { ...state, units, revivesUsed, rngState };
}

/** Deterministic 32-bit seed from an arbitrary string (e.g. sessionId). */
export function seedFromString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
