/**
 * Blyp Marble Race — pure deterministic auto-drive sim (no collisions).
 * Lane progress + seeded noise. Clients interpolate; server is authority.
 */

export type MarblePhase = 'lobby' | 'lock' | 'heat' | 'podium' | 'ended';

export const MARBLE_COLORS = ['#FF5A5F', '#00D2BE', '#FFB020', '#7B61FF', '#4DA3FF', '#E86BA8'] as const;
export const PLACE_POINTS = [10, 7, 5, 3, 2, 1] as const;
export const HEATS_TOTAL = 3;
/** Host + up to 5 guests (2–6 marbles including host). */
export const MAX_RACERS = 6;
export const MIN_RACERS = 2;
export const TICK_MS = 200;
export const LOBBY_TICKS = 75;
export const LOCK_TICKS = 25;
export const HEAT_TICKS = 300;
export const PODIUM_TICKS = 60;
export const CHEER_BOOST_CAP = 3;
export const CHEER_BOOST_TICKS = 8;
export const CHEER_BOOST_SPEED = 0.012;

export interface MarbleRacer {
  lane: number;
  userId: string;
  displayName: string;
  color: string;
  progress: number;
  place: number | null;
  boostsUsed: number;
  boostUntilTick: number;
  finishedAtTick: number | null;
}

export interface MarbleRaceState {
  phase: MarblePhase;
  heatIndex: number;
  heatsTotal: number;
  seed: number;
  tick: number;
  phaseStartedTick: number;
  phaseEndsAtTick: number;
  marbles: MarbleRacer[];
  placePoints: Record<string, number>;
  picks: Record<string, string>;
  finishedOrder: string[];
  lastCheer?: { racerUserId: string; senderUserId: string; atTick: number };
}

export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFromString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createRaceState(args: {
  seed: number;
  racers: Array<{ userId: string; displayName: string }>;
}): MarbleRaceState {
  const capped = args.racers.slice(0, MAX_RACERS);
  const marbles: MarbleRacer[] = capped.map((r, i) => ({
    lane: i,
    userId: r.userId,
    displayName: r.displayName || `Racer ${i + 1}`,
    color: MARBLE_COLORS[i % MARBLE_COLORS.length],
    progress: 0,
    place: null,
    boostsUsed: 0,
    boostUntilTick: 0,
    finishedAtTick: null,
  }));
  const placePoints: Record<string, number> = {};
  for (const m of marbles) placePoints[m.userId] = 0;
  return {
    phase: 'lobby',
    heatIndex: 0,
    heatsTotal: HEATS_TOTAL,
    seed: args.seed >>> 0,
    tick: 0,
    phaseStartedTick: 0,
    phaseEndsAtTick: LOBBY_TICKS,
    marbles,
    placePoints,
    picks: {},
    finishedOrder: [],
  };
}

function laneBaseSpeed(seed: number, heatIndex: number, lane: number): number {
  const rng = mulberry32((seed ^ (heatIndex * 7919) ^ (lane * 104729)) >>> 0);
  return 0.0034 + rng() * 0.0018;
}

function laneNoise(seed: number, heatIndex: number, lane: number, tick: number): number {
  const rng = mulberry32((seed ^ (heatIndex * 31) ^ (lane * 97) ^ (tick * 1009)) >>> 0);
  return (rng() - 0.5) * 0.0022;
}

export function stepRace(state: MarbleRaceState): MarbleRaceState {
  if (state.phase === 'ended') return state;
  const tick = state.tick + 1;
  let next: MarbleRaceState = { ...state, tick, marbles: state.marbles.map((m) => ({ ...m })) };
  if (next.phase === 'heat') next = stepHeat(next);
  if (tick >= next.phaseEndsAtTick) next = advancePhase(next);
  return next;
}

function stepHeat(state: MarbleRaceState): MarbleRaceState {
  const marbles = state.marbles.map((m) => {
    if (m.finishedAtTick != null) return m;
    const base = laneBaseSpeed(state.seed, state.heatIndex, m.lane);
    const noise = laneNoise(state.seed, state.heatIndex, m.lane, state.tick);
    const boost = state.tick < m.boostUntilTick ? CHEER_BOOST_SPEED : 0;
    let progress = Math.min(1, m.progress + base + noise + boost);
    let finishedAtTick: number | null = m.finishedAtTick;
    if (progress >= 1 && finishedAtTick == null) {
      progress = 1;
      finishedAtTick = state.tick;
    }
    return { ...m, progress, finishedAtTick };
  });
  const finishedOrder = [...state.finishedOrder];
  for (const m of marbles) {
    if (m.finishedAtTick === state.tick && !finishedOrder.includes(m.userId)) {
      finishedOrder.push(m.userId);
    }
  }
  const allDone = marbles.every((m) => m.finishedAtTick != null);
  let phaseEndsAtTick = state.phaseEndsAtTick;
  if (allDone) phaseEndsAtTick = Math.min(phaseEndsAtTick, state.tick + 1);
  return { ...state, marbles, finishedOrder, phaseEndsAtTick };
}

function assignPlaces(state: MarbleRaceState): MarbleRaceState {
  const order = [...state.finishedOrder];
  const unfinished = state.marbles
    .filter((m) => !order.includes(m.userId))
    .sort((a, b) => b.progress - a.progress || a.lane - b.lane);
  for (const m of unfinished) order.push(m.userId);
  const placePoints = { ...state.placePoints };
  const marbles = state.marbles.map((m) => {
    const place = order.indexOf(m.userId) + 1;
    const pts = PLACE_POINTS[place - 1] ?? 0;
    placePoints[m.userId] = (placePoints[m.userId] || 0) + pts;
    return { ...m, place, progress: Math.min(1, m.progress) };
  });
  return { ...state, marbles, placePoints, finishedOrder: order };
}

function resetHeatMarbles(state: MarbleRaceState): MarbleRacer[] {
  return state.marbles.map((m) => ({
    ...m,
    progress: 0,
    place: null,
    boostsUsed: 0,
    boostUntilTick: 0,
    finishedAtTick: null,
  }));
}

function advancePhase(state: MarbleRaceState): MarbleRaceState {
  if (state.phase === 'lobby') {
    return { ...state, phase: 'lock', phaseStartedTick: state.tick, phaseEndsAtTick: state.tick + LOCK_TICKS };
  }
  if (state.phase === 'lock') {
    return {
      ...state,
      phase: 'heat',
      phaseStartedTick: state.tick,
      phaseEndsAtTick: state.tick + HEAT_TICKS,
      marbles: resetHeatMarbles(state).map((m) => ({ ...m })),
      finishedOrder: [],
    };
  }
  if (state.phase === 'heat') {
    const placed = assignPlaces(state);
    return { ...placed, phase: 'podium', phaseStartedTick: state.tick, phaseEndsAtTick: state.tick + PODIUM_TICKS };
  }
  if (state.phase === 'podium') {
    const nextHeat = state.heatIndex + 1;
    if (nextHeat >= state.heatsTotal) {
      return { ...state, phase: 'ended', phaseStartedTick: state.tick, phaseEndsAtTick: state.tick };
    }
    return {
      ...state,
      phase: 'lobby',
      heatIndex: nextHeat,
      phaseStartedTick: state.tick,
      phaseEndsAtTick: state.tick + LOBBY_TICKS,
      marbles: resetHeatMarbles(state),
      finishedOrder: [],
      picks: {},
    };
  }
  return state;
}

export function hostNextHeat(state: MarbleRaceState): MarbleRaceState {
  if (state.phase === 'ended') return state;
  const nextHeat = state.phase === 'podium' ? state.heatIndex + 1 : state.heatIndex;
  if (nextHeat >= state.heatsTotal && state.phase === 'podium') {
    return { ...state, phase: 'ended', phaseEndsAtTick: state.tick };
  }
  const heatIndex = state.phase === 'podium' ? nextHeat : state.heatIndex;
  return {
    ...state,
    phase: 'lobby',
    heatIndex,
    phaseStartedTick: state.tick,
    phaseEndsAtTick: state.tick + LOBBY_TICKS,
    marbles: resetHeatMarbles(state),
    finishedOrder: [],
    picks: {},
  };
}

export function applyCheerBoost(
  state: MarbleRaceState,
  racerUserId: string,
): { state: MarbleRaceState; applied: boolean; reason?: string } {
  if (state.phase !== 'heat') return { state, applied: false, reason: 'NOT_HEAT' };
  const idx = state.marbles.findIndex((m) => m.userId === racerUserId);
  if (idx < 0) return { state, applied: false, reason: 'NO_RACER' };
  const m = state.marbles[idx];
  if (m.finishedAtTick != null) return { state, applied: false, reason: 'FINISHED' };
  if (m.boostsUsed >= CHEER_BOOST_CAP) return { state, applied: false, reason: 'CAP' };
  const marbles = state.marbles.slice();
  marbles[idx] = {
    ...m,
    boostsUsed: m.boostsUsed + 1,
    boostUntilTick: Math.max(m.boostUntilTick, state.tick) + CHEER_BOOST_TICKS,
  };
  return { state: { ...state, marbles }, applied: true };
}

export function setPick(
  state: MarbleRaceState,
  pickerUserId: string,
  racerUserId: string,
): MarbleRaceState {
  if (state.phase !== 'lobby') return state;
  if (!state.marbles.some((m) => m.userId === racerUserId)) return state;
  return { ...state, picks: { ...state.picks, [pickerUserId]: racerUserId } };
}
