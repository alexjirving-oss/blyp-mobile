import { createHash, createHmac, randomUUID } from 'crypto';
import {
  GRID9_MAX_HEALTH,
  GRID9_MAX_SHIELD_POINTS,
  GRID9_SENTINEL_MAX_REACTION_MS,
  type Grid9SlotIndex,
} from './constants';
import type {
  Grid9Player,
  Grid9SentinelAiProfile,
  Grid9SentinelPlayer,
} from './players';
import type { Grid9GameState } from './state';
import type { Grid9ShieldId, Grid9WeaponId } from './catalog';
import { GRID9_SHIELD_CATALOG, GRID9_WEAPON_CATALOG } from './catalog';

type SentinelTemplate = {
  characterId: string;
  displayName: string;
  ai: Grid9SentinelAiProfile;
};

const SENTINEL_TEMPLATES: readonly SentinelTemplate[] = [
  {
    characterId: 'ember',
    displayName: 'Sentinel Ember',
    ai: {
      profileId: 'aggressive-v1',
      targetStrategy: 'lowest_health',
      aggressionBps: 8200,
      shieldBelowHealth: 25,
      minimumReactionMs: 650,
      maximumReactionMs: 1600,
    },
  },
  {
    characterId: 'nova',
    displayName: 'Sentinel Nova',
    ai: {
      profileId: 'defensive-v1',
      targetStrategy: 'highest_support',
      aggressionBps: 4200,
      shieldBelowHealth: 60,
      minimumReactionMs: 1200,
      maximumReactionMs: 2800,
    },
  },
  {
    characterId: 'vex',
    displayName: 'Sentinel Vex',
    ai: {
      profileId: 'balanced-v1',
      targetStrategy: 'retaliatory',
      aggressionBps: 6200,
      shieldBelowHealth: 40,
      minimumReactionMs: 900,
      maximumReactionMs: 2200,
    },
  },
  {
    characterId: 'echo',
    displayName: 'Sentinel Echo',
    ai: {
      profileId: 'hunter-v1',
      targetStrategy: 'highest_health',
      aggressionBps: 7000,
      shieldBelowHealth: 30,
      minimumReactionMs: 800,
      maximumReactionMs: 1900,
    },
  },
  {
    characterId: 'onyx',
    displayName: 'Sentinel Onyx',
    ai: {
      profileId: 'sponsor-hunter-v1',
      targetStrategy: 'highest_support',
      aggressionBps: 6800,
      shieldBelowHealth: 35,
      minimumReactionMs: 850,
      maximumReactionMs: 2100,
    },
  },
  {
    characterId: 'pulse',
    displayName: 'Sentinel Pulse',
    ai: {
      profileId: 'chaos-v1',
      targetStrategy: 'random_survivor',
      aggressionBps: 5600,
      shieldBelowHealth: 45,
      minimumReactionMs: 1000,
      maximumReactionMs: 2400,
    },
  },
  {
    characterId: 'rift',
    displayName: 'Sentinel Rift',
    ai: {
      profileId: 'finisher-v1',
      targetStrategy: 'lowest_health',
      aggressionBps: 7600,
      shieldBelowHealth: 30,
      minimumReactionMs: 700,
      maximumReactionMs: 1700,
    },
  },
  {
    characterId: 'aegis',
    displayName: 'Sentinel Aegis',
    ai: {
      profileId: 'tank-v1',
      targetStrategy: 'highest_health',
      aggressionBps: 5000,
      shieldBelowHealth: 70,
      minimumReactionMs: 1100,
      maximumReactionMs: 2600,
    },
  },
  {
    characterId: 'flux',
    displayName: 'Sentinel Flux',
    ai: {
      profileId: 'random-v1',
      targetStrategy: 'random_survivor',
      aggressionBps: 6000,
      shieldBelowHealth: 40,
      minimumReactionMs: 950,
      maximumReactionMs: 2300,
    },
  },
] as const;

function deterministicUint32(value: string): number {
  return createHash('sha256').update(value, 'utf8').digest().readUInt32BE(0);
}

function effectiveHealth(player: Grid9Player): number {
  return player.health + player.shieldPoints;
}

function isWeaponId(id: string): id is Grid9WeaponId {
  return Object.prototype.hasOwnProperty.call(GRID9_WEAPON_CATALOG, id);
}

function isShieldId(id: string): id is Grid9ShieldId {
  return Object.prototype.hasOwnProperty.call(GRID9_SHIELD_CATALOG, id);
}

export function createGrid9Sentinel(
  matchId: string,
  slotIndex: Grid9SlotIndex,
  joinedAt: string,
): Grid9SentinelPlayer {
  const templateIndex =
    deterministicUint32(`${matchId}:sentinel:${slotIndex}`) %
    SENTINEL_TEMPLATES.length;
  const template = SENTINEL_TEMPLATES[templateIndex];
  return {
    slotId: randomUUID(),
    slotIndex,
    kind: 'sentinel',
    sentinelId: `grid9-${matchId.slice(0, 8)}-${slotIndex}`,
    displayName: template.displayName,
    avatarUrl: null,
    feed: {
      kind: 'sentinel_render',
      characterId: template.characterId,
      animationSeed: deterministicUint32(
        `${matchId}:animation:${slotIndex}`,
      ),
    },
    status: 'alive',
    mode: 'combatant',
    connectionState: 'not_applicable',
    health: GRID9_MAX_HEALTH,
    maxHealth: GRID9_MAX_HEALTH,
    shieldPoints: 0,
    maxShieldPoints: GRID9_MAX_SHIELD_POINTS,
    inventory: [],
    mercenaryBankrollCoins: 0,
    mercenarySponsorCoins: 0,
    mercenaryMicroDropCoins: 0,
    supporterTotalCoins: 0,
    topSupporters: [],
    stats: {
      attacksPurchased: 0,
      shieldsPurchased: 0,
      damageDealt: 0,
      damageReceived: 0,
      coinsSpent: 0,
      mercenaryCoinsReceived: 0,
      microDropsReceived: 0,
    },
    joinedAt,
    eliminatedAt: null,
    eliminatedBy: null,
    lastDamagedAt: null,
    ai: { ...template.ai },
  };
}

function orderedTargets(
  state: Grid9GameState,
  sentinel: Grid9SentinelPlayer,
): Grid9Player[] {
  const targets = state.players.filter(
    (player) =>
      player.status === 'alive' && player.slotIndex !== sentinel.slotIndex,
  );
  const byLowestHealth = (left: Grid9Player, right: Grid9Player) =>
    effectiveHealth(left) - effectiveHealth(right) ||
    left.slotIndex - right.slotIndex;
  const byHighestHealth = (left: Grid9Player, right: Grid9Player) =>
    effectiveHealth(right) - effectiveHealth(left) ||
    left.slotIndex - right.slotIndex;

  if (sentinel.ai.targetStrategy === 'lowest_health') {
    return targets.sort(byLowestHealth);
  }
  if (sentinel.ai.targetStrategy === 'highest_health') {
    return targets.sort(byHighestHealth);
  }
  if (sentinel.ai.targetStrategy === 'highest_support') {
    return targets.sort(
      (left, right) =>
        right.supporterTotalCoins - left.supporterTotalCoins ||
        byLowestHealth(left, right),
    );
  }
  if (sentinel.ai.targetStrategy === 'retaliatory') {
    const lastTarget = state.lastAction?.targetSlotIndex;
    const retaliatory = targets.find(
      (candidate) =>
        candidate.slotIndex !== lastTarget &&
        state.lastAction?.affectedSlotIndices.includes(sentinel.slotIndex),
    );
    if (retaliatory) {
      return [
        retaliatory,
        ...targets.filter(
          (candidate) => candidate.slotIndex !== retaliatory.slotIndex,
        ),
      ];
    }
    return targets.sort(byLowestHealth);
  }

  if (targets.length <= 1) return targets;
  const digest = createHmac(
    'sha256',
    Buffer.from(state.authority.entropySeed, 'base64url'),
  )
    .update(
      `grid9:sentinel-target:${state.matchId}:${state.turn?.turnNumber ?? 0}:${sentinel.slotIndex}`,
      'utf8',
    )
    .digest();
  const chosen = digest.readUInt32BE(0) % targets.length;
  return [
    targets[chosen],
    ...targets.filter((_, index) => index !== chosen).sort(byLowestHealth),
  ];
}

export type Grid9SentinelPaymentKind =
  | 'inventory'
  | 'free_drop'
  | 'mercenary_bankroll';

export type Grid9SentinelDecision =
  | {
      kind: 'weapon';
      weaponId: Grid9WeaponId;
      targetSlotIndex: Grid9SlotIndex;
      payment: Grid9SentinelPaymentKind;
    }
  | {
      kind: 'shield';
      shieldId: Grid9ShieldId;
      payment: Grid9SentinelPaymentKind;
    };

function pickBankrollWeapon(bankrollCoins: number, aggressionBps: number): Grid9WeaponId | null {
  if (
    aggressionBps >= 7600 &&
    bankrollCoins >= GRID9_WEAPON_CATALOG.mega_bomb.costCoins
  ) {
    return 'mega_bomb';
  }
  if (
    aggressionBps >= 6000 &&
    bankrollCoins >= GRID9_WEAPON_CATALOG.fireball.costCoins
  ) {
    return 'fireball';
  }
  if (bankrollCoins >= GRID9_WEAPON_CATALOG.arrow.costCoins) {
    return 'arrow';
  }
  return null;
}

function chooseWeaponOption(
  state: Grid9GameState,
  sentinel: Grid9SentinelPlayer,
): Extract<Grid9SentinelDecision, { kind: 'weapon' }> | null {
  const enemy = orderedTargets(state, sentinel)[0];

  const resolveTarget = (weaponId: Grid9WeaponId): Grid9SlotIndex | null => {
    if (GRID9_WEAPON_CATALOG[weaponId].healHealth > 0) {
      return sentinel.slotIndex;
    }
    return enemy?.slotIndex ?? null;
  };

  if (
    state.turn?.freeDropEquipped &&
    state.turn.freeDropItemId &&
    isWeaponId(state.turn.freeDropItemId)
  ) {
    const targetSlotIndex = resolveTarget(state.turn.freeDropItemId);
    if (targetSlotIndex == null) return null;
    return {
      kind: 'weapon',
      weaponId: state.turn.freeDropItemId,
      targetSlotIndex,
      payment: 'free_drop',
    };
  }

  const inventoryWeapon = sentinel.inventory.find(isWeaponId);
  if (inventoryWeapon) {
    const targetSlotIndex = resolveTarget(inventoryWeapon);
    if (targetSlotIndex == null) return null;
    return {
      kind: 'weapon',
      weaponId: inventoryWeapon,
      targetSlotIndex,
      payment: 'inventory',
    };
  }

  const bankrollWeapon = pickBankrollWeapon(
    sentinel.mercenaryBankrollCoins,
    sentinel.ai.aggressionBps,
  );
  if (bankrollWeapon) {
    const targetSlotIndex = resolveTarget(bankrollWeapon);
    if (targetSlotIndex == null) return null;
    return {
      kind: 'weapon',
      weaponId: bankrollWeapon,
      targetSlotIndex,
      payment: 'mercenary_bankroll',
    };
  }

  return null;
}

function chooseShieldOption(
  state: Grid9GameState,
  sentinel: Grid9SentinelPlayer,
): Extract<Grid9SentinelDecision, { kind: 'shield' }> | null {
  if (
    state.turn?.freeDropEquipped &&
    state.turn.freeDropItemId &&
    isShieldId(state.turn.freeDropItemId)
  ) {
    return {
      kind: 'shield',
      shieldId: state.turn.freeDropItemId,
      payment: 'free_drop',
    };
  }

  const inventoryShield = sentinel.inventory.find(isShieldId);
  if (inventoryShield) {
    return {
      kind: 'shield',
      shieldId: inventoryShield,
      payment: 'inventory',
    };
  }

  if (
    sentinel.mercenaryBankrollCoins >= GRID9_SHIELD_CATALOG.basic_shield.costCoins
  ) {
    return {
      kind: 'shield',
      shieldId: 'basic_shield',
      payment: 'mercenary_bankroll',
    };
  }

  return null;
}

/**
 * Server-side bot decision for a sentinel spotlight seat.
 * Prefers inventory / free-drop so bots act without waiting for client intents
 * or mercenary funding. Returns null → caller auto-shields / passes.
 */
export function chooseGrid9SentinelDecision(
  state: Grid9GameState,
  sentinel: Grid9SentinelPlayer,
): Grid9SentinelDecision | null {
  if (state.phase !== 'combat' || sentinel.status !== 'alive' || !state.turn) {
    return null;
  }
  if (state.turn.spotlightSlotIndex !== sentinel.slotIndex) {
    return null;
  }
  if (
    state.turn.attacksUsedThisTurn >= 1 &&
    state.turn.defensesUsedThisTurn >= 1
  ) {
    return null;
  }

  const preferShield =
    sentinel.health <= sentinel.ai.shieldBelowHealth &&
    state.turn.defensesUsedThisTurn < 1;

  if (preferShield) {
    const shield = chooseShieldOption(state, sentinel);
    if (shield) return shield;
  }

  if (state.turn.attacksUsedThisTurn < 1) {
    const weapon = chooseWeaponOption(state, sentinel);
    if (weapon) return weapon;
  }

  if (state.turn.defensesUsedThisTurn < 1) {
    const shield = chooseShieldOption(state, sentinel);
    if (shield) return shield;
  }

  return null;
}

/** Deterministic reaction delay for sentinel spotlight, capped ~1.5s. */
export function grid9SentinelReactionMs(sentinel: Grid9SentinelPlayer): number {
  const mid = Math.floor(
    (sentinel.ai.minimumReactionMs + sentinel.ai.maximumReactionMs) / 2,
  );
  return Math.min(
    GRID9_SENTINEL_MAX_REACTION_MS,
    Math.max(500, Math.min(mid, GRID9_SENTINEL_MAX_REACTION_MS)),
  );
}

/**
 * Combat turn timer due-at:
 * - Sentinel: ~1.5s auto-act ceiling
 * - After any spotlight act (attack/shield) or auto-resolved: immediate → next roulette
 * - Otherwise: full 30s window
 */
export function grid9CombatTimerDueAtMs(state: Grid9GameState): number | null {
  if (state.phase !== 'combat' || !state.turn) return null;
  const endsAt = Date.parse(state.turn.endsAt);
  const nowMs = Date.now();
  const spotlight = state.players[state.turn.spotlightSlotIndex];
  if (!spotlight || spotlight.status !== 'alive') {
    return Math.min(endsAt, nowMs);
  }
  if (state.turn.autoResolved || state.turn.attacksUsedThisTurn >= 1) {
    return Math.min(endsAt, nowMs);
  }
  // Any completed act (weapon OR shield) must advance to roulette immediately.
  if (state.turn.defensesUsedThisTurn >= 1) {
    return Math.min(endsAt, nowMs);
  }
  if (spotlight.kind === 'sentinel') {
    const startedAt = Date.parse(state.turn.startedAt);
    const early = startedAt + grid9SentinelReactionMs(spotlight);
    return Math.min(endsAt, early);
  }
  return endsAt;
}
