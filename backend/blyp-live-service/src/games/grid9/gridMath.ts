import {
  GRID9_MAX_SHIELD_POINTS,
  GRID9_SLOT_COUNT,
  GRID9_SLOT_INDICES,
  type Grid9SlotIndex,
} from './constants';

export interface Grid9DamageAllocation {
  rawDamage: number;
  shieldPierceDamage: number;
  shieldDamage: number;
  healthDamage: number;
  shieldAfter: number;
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
}

export function grid9Row(slotIndex: Grid9SlotIndex): number {
  return Math.floor(slotIndex / 3);
}

export function grid9Column(slotIndex: Grid9SlotIndex): number {
  return slotIndex % 3;
}

export function grid9OrthogonalNeighbors(
  slotIndex: Grid9SlotIndex,
): Grid9SlotIndex[] {
  const row = grid9Row(slotIndex);
  const column = grid9Column(slotIndex);
  return GRID9_SLOT_INDICES.filter((candidate) => {
    const rowDistance = Math.abs(grid9Row(candidate) - row);
    const columnDistance = Math.abs(grid9Column(candidate) - column);
    return rowDistance + columnDistance === 1;
  });
}

export function grid9AllAdjacentNeighbors(
  slotIndex: Grid9SlotIndex,
): Grid9SlotIndex[] {
  const row = grid9Row(slotIndex);
  const column = grid9Column(slotIndex);
  return GRID9_SLOT_INDICES.filter((candidate) => {
    if (candidate === slotIndex) return false;
    const rowDistance = Math.abs(grid9Row(candidate) - row);
    const columnDistance = Math.abs(grid9Column(candidate) - column);
    return Math.max(rowDistance, columnDistance) === 1;
  });
}

export function allocateGrid9Damage(args: {
  rawDamage: number;
  shieldBefore: number;
  shieldPierceBps: number;
}): Grid9DamageAllocation {
  assertNonNegativeInteger(args.rawDamage, 'rawDamage');
  assertNonNegativeInteger(args.shieldBefore, 'shieldBefore');
  assertNonNegativeInteger(args.shieldPierceBps, 'shieldPierceBps');
  if (args.shieldBefore > GRID9_MAX_SHIELD_POINTS) {
    throw new RangeError(`shieldBefore cannot exceed ${GRID9_MAX_SHIELD_POINTS}`);
  }
  if (args.shieldPierceBps > 10_000) {
    throw new RangeError('shieldPierceBps cannot exceed 10000');
  }

  const shieldPierceDamage = Math.floor(
    (args.rawDamage * args.shieldPierceBps) / 10_000,
  );
  const blockableDamage = args.rawDamage - shieldPierceDamage;
  const shieldDamage = Math.min(args.shieldBefore, blockableDamage);
  const healthDamage =
    shieldPierceDamage + Math.max(0, blockableDamage - shieldDamage);

  return {
    rawDamage: args.rawDamage,
    shieldPierceDamage,
    shieldDamage,
    healthDamage,
    shieldAfter: args.shieldBefore - shieldDamage,
  };
}

export function assertGrid9PlayerCount(players: readonly unknown[]): void {
  if (players.length !== GRID9_SLOT_COUNT) {
    throw new RangeError(`Grid 9 requires exactly ${GRID9_SLOT_COUNT} players`);
  }
}
