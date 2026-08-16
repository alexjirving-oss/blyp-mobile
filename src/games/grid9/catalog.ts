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
  /** When > 0, heals target seat HP instead of dealing damage. */
  healHealth: number;
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
    displayName: 'Arrow',
    description: 'A fast direct strike against one surviving box.',
    glyph: '⚡',
    costCoins: 10,
    jackpotContributionCoins: 5,
    directDamage: 20,
    healHealth: 0,
    adjacentDamage: 0,
    splashPattern: 'none',
    cooldownMs: 0,
  },
  fireball: {
    id: 'fireball',
    kind: 'weapon',
    displayName: 'Fireball',
    description: 'A strike that scorches orthogonally adjacent boxes.',
    glyph: '🔥',
    costCoins: 25,
    jackpotContributionCoins: 12,
    directDamage: 40,
    healHealth: 0,
    adjacentDamage: 10,
    splashPattern: 'orthogonal',
    cooldownMs: 30_000,
  },
  mega_bomb: {
    id: 'mega_bomb',
    kind: 'weapon',
    displayName: 'Mega Bomb',
    description: 'A major single-target blast.',
    glyph: '💣',
    costCoins: 50,
    jackpotContributionCoins: 25,
    directDamage: 60,
    healHealth: 0,
    adjacentDamage: 0,
    splashPattern: 'none',
    cooldownMs: 60_000,
  },
  kiss: {
    id: 'kiss',
    kind: 'weapon',
    displayName: 'Kiss',
    description: 'Restores +20 HP to one surviving box (capped at max HP).',
    glyph: '💋',
    costCoins: 12,
    jackpotContributionCoins: 6,
    directDamage: 0,
    healHealth: 20,
    adjacentDamage: 0,
    splashPattern: 'none',
    cooldownMs: 0,
  },
} as const satisfies Readonly<Record<Grid9WeaponId, Grid9Weapon>>;

export const GRID9_SHIELD_CATALOG = {
  basic_shield: {
    id: 'basic_shield',
    kind: 'shield',
    displayName: 'Shield',
    description: 'Adds 30 shield points to one surviving box, up to the shield cap.',
    glyph: '🛡',
    costCoins: 15,
    jackpotContributionCoins: 8,
    shieldPoints: 30,
    cooldownMs: 0,
  },
} as const satisfies Readonly<Record<Grid9ShieldId, Grid9Shield>>;

export const GRID9_ARSENAL_ORDER: readonly Grid9ArsenalItemId[] = [
  'arrow',
  'fireball',
  'mega_bomb',
  'kiss',
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

export function isGrid9HealWeapon(itemId: string): boolean {
  return itemId === 'kiss';
}
