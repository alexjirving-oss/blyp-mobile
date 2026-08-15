export type Grid9WeaponId = 'arrow' | 'fireball' | 'mega_bomb';
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
  adjacentDamage: number;
  splashPattern: Grid9SplashPattern;
  shieldPierceBps: number;
  cooldownMs: number;
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
}

export const GRID9_WEAPON_CATALOG = {
  arrow: {
    id: 'arrow',
    kind: 'weapon',
    displayName: 'Arrow',
    description: 'A fast direct strike against one surviving box.',
    costCoins: 10,
    jackpotContributionCoins: 5,
    directDamage: 12,
    adjacentDamage: 0,
    splashPattern: 'none',
    shieldPierceBps: 0,
    cooldownMs: 1_500,
  },
  fireball: {
    id: 'fireball',
    kind: 'weapon',
    displayName: 'Fireball',
    description: 'A heavy strike that scorches orthogonally adjacent boxes.',
    costCoins: 50,
    jackpotContributionCoins: 25,
    directDamage: 30,
    adjacentDamage: 8,
    splashPattern: 'orthogonal',
    shieldPierceBps: 1_500,
    cooldownMs: 4_000,
  },
  mega_bomb: {
    id: 'mega_bomb',
    kind: 'weapon',
    displayName: 'Mega Bomb',
    description: 'A major blast that damages the target and every adjacent box.',
    costCoins: 200,
    jackpotContributionCoins: 100,
    directDamage: 55,
    adjacentDamage: 20,
    splashPattern: 'all_adjacent',
    shieldPierceBps: 2_500,
    cooldownMs: 10_000,
  },
} as const satisfies Readonly<Record<Grid9WeaponId, Grid9Weapon>>;

export const GRID9_SHIELD_CATALOG = {
  basic_shield: {
    id: 'basic_shield',
    kind: 'shield',
    displayName: 'Basic Shield',
    description: 'Adds 20 shield points to one surviving box, up to the shield cap.',
    costCoins: 25,
    jackpotContributionCoins: 13,
    shieldPoints: 20,
    cooldownMs: 3_000,
  },
} as const satisfies Readonly<Record<Grid9ShieldId, Grid9Shield>>;

export const GRID9_WEAPON_ORDER = ['arrow', 'fireball', 'mega_bomb'] as const;
export const GRID9_SHIELD_ORDER = ['basic_shield'] as const;

export const GRID9_ARSENAL_CATALOG: Readonly<
  Record<Grid9ArsenalItemId, Grid9Weapon | Grid9Shield>
> = {
  ...GRID9_WEAPON_CATALOG,
  ...GRID9_SHIELD_CATALOG,
};
