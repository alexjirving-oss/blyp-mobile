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
  jackpotContributionCoins: number;
  directDamage: number;
  /** When > 0, weapon heals the target seat instead of dealing damage. */
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

export const GRID9_WEAPON_CATALOG = {
  arrow: {
    id: 'arrow',
    kind: 'weapon',
    displayName: 'Arrow',
    description: 'A fast direct strike against one surviving box.',
    costCoins: 10,
    jackpotContributionCoins: 5,
    directDamage: 20,
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
    description: 'A strike that scorches orthogonally adjacent boxes.',
    costCoins: 25,
    jackpotContributionCoins: 12,
    directDamage: 40,
    healHealth: 0,
    adjacentDamage: 10,
    splashPattern: 'orthogonal',
    shieldPierceBps: 0,
    cooldownMs: 30_000,
    turnCooldownTurns: 1,
  },
  mega_bomb: {
    id: 'mega_bomb',
    kind: 'weapon',
    displayName: 'Mega Bomb',
    description: 'A major single-target blast.',
    costCoins: 50,
    jackpotContributionCoins: 25,
    directDamage: 60,
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
    description: 'A support gift that restores +20 HP to one surviving box (capped at max HP).',
    /** Cheap support gift — between Arrow and Shield; 50% to jackpot like Arrow. */
    costCoins: 12,
    jackpotContributionCoins: 6,
    directDamage: 0,
    healHealth: 20,
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
    jackpotContributionCoins: 8,
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
