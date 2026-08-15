import type { Grid9ShieldId, Grid9WeaponId } from './constants';

export type Grid9ArsenalItemId = Grid9WeaponId | Grid9ShieldId;
export type Grid9SplashPattern = 'none' | 'orthogonal' | 'all_adjacent';

export interface Grid9Weapon {
  id: Grid9WeaponId;
  kind: 'weapon';
  displayName: string;
  description: string;
  glyph: string;
  costCoins: number;
  jackpotContributionCoins: number;
  directDamage: number;
  adjacentDamage: number;
  splashPattern: Grid9SplashPattern;
  cooldownMs: number;
}

export interface Grid9Shield {
  id: Grid9ShieldId;
  kind: 'shield';
  displayName: string;
  description: string;
  glyph: string;
  costCoins: number;
  jackpotContributionCoins: number;
  shieldPoints: number;
  cooldownMs: number;
}

export type Grid9ArsenalItem = Grid9Weapon | Grid9Shield;

export const GRID9_WEAPON_CATALOG = {
  arrow: {
    id: 'arrow',
    kind: 'weapon',
    displayName: 'Quick Arrow',
    description: 'A fast direct strike against one surviving box.',
    glyph: '⚡',
    costCoins: 10,
    jackpotContributionCoins: 5,
    directDamage: 12,
    adjacentDamage: 0,
    splashPattern: 'none',
    cooldownMs: 1_500,
  },
  fireball: {
    id: 'fireball',
    kind: 'weapon',
    displayName: 'Fireball',
    description: 'A heavy strike that scorches orthogonally adjacent boxes.',
    glyph: '🔥',
    costCoins: 50,
    jackpotContributionCoins: 25,
    directDamage: 30,
    adjacentDamage: 8,
    splashPattern: 'orthogonal',
    cooldownMs: 4_000,
  },
  mega_bomb: {
    id: 'mega_bomb',
    kind: 'weapon',
    displayName: 'Mega Bomb',
    description: 'A major blast that damages the target and every adjacent box.',
    glyph: '💣',
    costCoins: 200,
    jackpotContributionCoins: 100,
    directDamage: 55,
    adjacentDamage: 20,
    splashPattern: 'all_adjacent',
    cooldownMs: 10_000,
  },
} as const satisfies Readonly<Record<Grid9WeaponId, Grid9Weapon>>;

export const GRID9_SHIELD_CATALOG = {
  basic_shield: {
    id: 'basic_shield',
    kind: 'shield',
    displayName: 'Nano Shield',
    description: 'Adds 20 shield points to one surviving box, up to the shield cap.',
    glyph: '🛡',
    costCoins: 25,
    jackpotContributionCoins: 13,
    shieldPoints: 20,
    cooldownMs: 3_000,
  },
} as const satisfies Readonly<Record<Grid9ShieldId, Grid9Shield>>;

export const GRID9_ARSENAL_ORDER: readonly Grid9ArsenalItemId[] = [
  'arrow',
  'fireball',
  'mega_bomb',
  'basic_shield',
];

export const GRID9_ARSENAL_CATALOG: Readonly<Record<Grid9ArsenalItemId, Grid9ArsenalItem>> = {
  ...GRID9_WEAPON_CATALOG,
  ...GRID9_SHIELD_CATALOG,
};

export const GRID9_DEFAULT_MERCENARY_FUND_COINS = 25 as const;

export function listGrid9Arsenal(): Grid9ArsenalItem[] {
  return GRID9_ARSENAL_ORDER.map((id) => GRID9_ARSENAL_CATALOG[id]);
}
