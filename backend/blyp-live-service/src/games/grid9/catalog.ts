import { splitGrid9AudienceGiftCoins } from './constants';

export type Grid9WeaponId = 'arrow' | 'fireball' | 'mega_bomb' | 'kiss';
export type Grid9ShieldId = 'basic_shield';
export type Grid9ArsenalItemId = Grid9WeaponId | Grid9ShieldId;

export type Grid9SplashPattern = 'none' | 'orthogonal' | 'all_adjacent';

export interface Grid9Weapon {
  id: Grid9WeaponId;
  kind: 'weapon';
  displayName: string;
  description: string;
  costCoins: number;
  /** Paid purchase jackpot share — matches splitGrid9AudienceGiftCoins().jackpotCoins. */
  jackpotContributionCoins: number;
  /**
   * Direct HP damage. Alex: coin amount = health effect.
   * Engine also enforces directDamage = costCoins for paid/gift resolve.
   */
  directDamage: number;
  /** When > 0, weapon heals the target seat by coin face (healHealth = costCoins). */
  healHealth: number;
  adjacentDamage: number;
  splashPattern: Grid9SplashPattern;
  shieldPierceBps: number;
  cooldownMs: number;
  turnCooldownTurns: number;
}

export interface Grid9Shield {
  id: Grid9ShieldId;
  kind: 'shield';
  displayName: string;
  description: string;
  costCoins: number;
  jackpotContributionCoins: number;
  shieldPoints: number;
  cooldownMs: number;
  turnCooldownTurns: number;
}

function jackpotShare(cost: number): number {
  return splitGrid9AudienceGiftCoins(cost).jackpotCoins;
}

export const GRID9_WEAPON_CATALOG = {
  arrow: {
    id: 'arrow',
    kind: 'weapon',
    displayName: 'Arrow',
    description: 'Direct strike — damage equals coin face (10).',
    costCoins: 10,
    jackpotContributionCoins: jackpotShare(10),
    directDamage: 10,
    healHealth: 0,
    adjacentDamage: 0,
    splashPattern: 'none',
    shieldPierceBps: 0,
    cooldownMs: 0,
    turnCooldownTurns: 0,
  },
  fireball: {
    id: 'fireball',
    kind: 'weapon',
    displayName: 'Fireball',
    description: 'Direct strike equal to coin face (25); light orthogonal splash.',
    costCoins: 25,
    jackpotContributionCoins: jackpotShare(25),
    directDamage: 25,
    healHealth: 0,
    adjacentDamage: 5,
    splashPattern: 'orthogonal',
    shieldPierceBps: 0,
    cooldownMs: 30_000,
    turnCooldownTurns: 1,
  },
  mega_bomb: {
    id: 'mega_bomb',
    kind: 'weapon',
    displayName: 'Mega Bomb',
    description: 'Major blast — damage equals coin face (50).',
    costCoins: 50,
    jackpotContributionCoins: jackpotShare(50),
    directDamage: 50,
    healHealth: 0,
    adjacentDamage: 0,
    splashPattern: 'none',
    shieldPierceBps: 0,
    cooldownMs: 60_000,
    turnCooldownTurns: 2,
  },
  kiss: {
    id: 'kiss',
    kind: 'weapon',
    displayName: 'Kiss',
    description: 'Heal gift — restores HP equal to coin face (12).',
    costCoins: 12,
    jackpotContributionCoins: jackpotShare(12),
    directDamage: 0,
    healHealth: 12,
    adjacentDamage: 0,
    splashPattern: 'none',
    shieldPierceBps: 0,
    cooldownMs: 0,
    turnCooldownTurns: 0,
  },
} as const satisfies Readonly<Record<Grid9WeaponId, Grid9Weapon>>;

export const GRID9_SHIELD_CATALOG = {
  basic_shield: {
    id: 'basic_shield',
    kind: 'shield',
    displayName: 'Shield',
    description: 'Adds 30 shield points to one surviving box, up to the shield cap.',
    costCoins: 15,
    jackpotContributionCoins: jackpotShare(15),
    shieldPoints: 30,
    cooldownMs: 0,
    turnCooldownTurns: 0,
  },
} as const satisfies Readonly<Record<Grid9ShieldId, Grid9Shield>>;

export const GRID9_WEAPON_ORDER = ['arrow', 'fireball', 'mega_bomb', 'kiss'] as const;
export const GRID9_SHIELD_ORDER = ['basic_shield'] as const;

export const GRID9_ARSENAL_CATALOG: Readonly<
  Record<Grid9ArsenalItemId, Grid9Weapon | Grid9Shield>
> = {
  ...GRID9_WEAPON_CATALOG,
  ...GRID9_SHIELD_CATALOG,
};
