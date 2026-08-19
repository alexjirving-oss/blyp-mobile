import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  GRID9_ARSENAL_CATALOG,
  GRID9_COUNTDOWN_MS,
  GRID9_MAX_ESCROW_RESERVE_COINS,
  GRID9_MAX_HEALTH,
  GRID9_MAX_MATCH_DURATION_MS,
  GRID9_MAX_MERCENARY_FUND_COINS,
  GRID9_MAX_SHIELD_POINTS,
  GRID9_MICRO_DROP_COIN_REWARD,
  GRID9_MICRO_DROP_SHIELD_REWARD,
  GRID9_MIN_MERCENARY_FUND_COINS,
  GRID9_MIN_ESCROW_RESERVE_COINS,
  GRID9_PUBLIC_LOBBY_MS,
  GRID9_ROULETTE_DURATION_MS,
  GRID9_RULES_VERSION,
  GRID9_SENTINEL_FILL_DELAY_MS,
  GRID9_SHIELD_CATALOG,
  GRID9_SLOT_COUNT,
  GRID9_SLOT_INDICES,
  GRID9_SPOTLIGHT_DURATION_MS,
  GRID9_TURN_DURATION_MS,
  GRID9_WEAPON_CATALOG,
  allocateGrid9EscrowSpend,
  allocateGrid9MercenarySpend,
  allocateGrid9Damage,
  createGrid9CryptographicNonce,
  deriveGrid9MicroDrop,
  grid9CanonicalIntentHash,
  grid9AggregateFields,
  grid9AllAdjacentNeighbors,
  grid9EntropyCommitment,
  grid9OrthogonalNeighbors,
  grid9RedisKeys,
  isGrid9NonceEncoding,
  isGrid9SlotIndex,
  parseGrid9GameState,
  type Grid9GameState,
  type Grid9PlayerSlots,
  type Grid9SentinelPlayer,
} from './index';

describe('Grid 9 phase-one contracts', () => {
  it('defines exactly nine unique arena slots', () => {
    assert.equal(GRID9_SLOT_COUNT, 9);
    assert.equal(GRID9_SLOT_INDICES.length, 9);
    assert.equal(new Set(GRID9_SLOT_INDICES).size, 9);
    assert.equal(GRID9_SLOT_INDICES.every(isGrid9SlotIndex), true);
    assert.equal(isGrid9SlotIndex(-1), false);
    assert.equal(isGrid9SlotIndex(9), false);
    assert.equal(isGrid9SlotIndex(1.5), false);
  });

  it('requires every paid arsenal item to feed the jackpot', () => {
    const items = Object.values(GRID9_ARSENAL_CATALOG);
    assert.equal(items.length, 5);
    for (const item of items) {
      assert.equal(Number.isInteger(item.costCoins), true);
      assert.equal(Number.isInteger(item.jackpotContributionCoins), true);
      assert.ok(item.costCoins > 0);
      assert.ok(item.jackpotContributionCoins > 0);
      assert.ok(item.jackpotContributionCoins <= item.costCoins);
    }
    assert.equal(Object.keys(GRID9_WEAPON_CATALOG).length, 4);
    assert.equal(Object.keys(GRID9_SHIELD_CATALOG).length, 1);
    assert.deepEqual(
      Object.fromEntries(
        Object.values(GRID9_ARSENAL_CATALOG).map((item) => [
          item.id,
          [item.costCoins, item.jackpotContributionCoins],
        ]),
      ),
      {
        arrow: [10, 1],
        fireball: [25, 2],
        mega_bomb: [50, 5],
        kiss: [12, 1],
        basic_shield: [15, 1],
      },
    );
  });

  it('stores every atomic match mutation in one aggregate hash', () => {
    const matchId = '3f6582f0-808d-468b-b88f-e208aa56cff3';
    const userId = '26522274-e001-70aa-51b6-bcbbdffc43bb';
    const intentId = '8aab0f2a-9917-4eaa-b760-13ccbfa1c58f';
    const digest = 'a'.repeat(64);
    const hashTag = `{${matchId}}`;
    const aggregateKey = grid9RedisKeys.matchAggregate(matchId);
    assert.equal(aggregateKey.includes(hashTag), true);
    assert.equal(grid9AggregateFields.escrow(userId), `escrow:${userId}`);
    assert.equal(
      grid9AggregateFields.nonce(userId, digest),
      `nonce:${userId}:${digest}`,
    );
    assert.equal(
      grid9AggregateFields.intent(userId, intentId),
      `intent:${userId}:${intentId}`,
    );
  });

  it('co-locates regional rollover, passes, queue, and assignments', () => {
    const region = 'eu-west-2';
    const hashTag = `{${region}}`;
    const keys = [
      grid9RedisKeys.regionalAggregate(region),
      grid9RedisKeys.queue(region),
      grid9RedisKeys.queueEntry(region, 'ticket-1'),
      grid9RedisKeys.assignment(region, 'assignment-1'),
    ];
    assert.equal(keys.every((key) => key.includes(hashTag)), true);
  });

  it('generates and validates a 128-bit base64url server nonce', () => {
    const nonce = createGrid9CryptographicNonce();
    assert.equal(Buffer.from(nonce, 'base64url').length, 16);
    assert.equal(isGrid9NonceEncoding(nonce), true);
    assert.equal(isGrid9NonceEncoding('short'), false);
    assert.equal(isGrid9NonceEncoding('rQ6M4xXJxY6OcJ2VXQJ3Nw='), false);
    assert.equal(isGrid9NonceEncoding('rQ6M4xXJxY6OcJ2VXQJ3Nw!'), false);
  });

  it('binds idempotency to user, match, command, and canonical payload', () => {
    const base = {
      authenticatedUserId: 'user-a',
      matchId: 'match-a',
      type: 'FIRE_WEAPON' as const,
      payload: { targetSlotIndex: 4, weaponId: 'arrow' },
    };
    const first = grid9CanonicalIntentHash(base);
    const reordered = grid9CanonicalIntentHash({
      ...base,
      payload: { weaponId: 'arrow', targetSlotIndex: 4 },
    });
    assert.equal(first, reordered);
    assert.notEqual(
      first,
      grid9CanonicalIntentHash({ ...base, authenticatedUserId: 'user-b' }),
    );
    assert.notEqual(
      first,
      grid9CanonicalIntentHash({ ...base, type: 'PURCHASE_SHIELD' }),
    );
  });

  it('defines row-major splash and shield-pierce rounding', () => {
    assert.deepEqual(grid9OrthogonalNeighbors(4), [1, 3, 5, 7]);
    assert.deepEqual(grid9AllAdjacentNeighbors(0), [1, 3, 4]);
    assert.deepEqual(
      allocateGrid9Damage({
        rawDamage: 30,
        shieldBefore: 20,
        shieldPierceBps: 1_500,
      }),
      {
        rawDamage: 30,
        shieldPierceDamage: 4,
        shieldDamage: 20,
        healthDamage: 10,
        shieldAfter: 0,
      },
    );
  });

  it('spends house micro-drops before platform-reserved coins', () => {
    assert.deepEqual(
      allocateGrid9EscrowSpend(
        {
          schemaVersion: 1,
          matchId: 'match-a',
          userId: 'user-a',
          currency: 'coins',
          status: 'open',
          platformReservedCoins: 10,
          microDropCreditCoins: 5,
          availableCoins: 15,
          spentCoins: 0,
          spentPlatformCoins: 0,
          spentMicroDropCoins: 0,
          refundedCoins: 0,
          refundedPlatformCoins: 0,
          refundedMicroDropCoins: 0,
          releasedCoins: 0,
          expiredMicroDropCoins: 0,
          reservationIds: ['reservation-a'],
          version: 1,
          openedAt: '2026-08-15T03:30:00.000Z',
          updatedAt: '2026-08-15T03:30:00.000Z',
          settledAt: null,
        },
        12,
      ),
      {
        amountCoins: 12,
        microDropCoins: 5,
        platformReservationCoins: 7,
      },
    );
  });

  it('tracks Sentinel bankroll origin without minting free purchases', () => {
    assert.deepEqual(
      allocateGrid9MercenarySpend({
        sponsorCoins: 40,
        microDropCoins: 5,
        amountCoins: 10,
      }),
      {
        amountCoins: 10,
        microDropCoins: 5,
        sponsorCoins: 5,
        origin: 'mixed',
      },
    );
  });

  it('derives an auditable micro-drop from committed entropy', () => {
    assert.deepEqual(
      deriveGrid9MicroDrop({
        entropySeed: 'fjVfkwHQpX4j_wbKx-fQfN1l0urqzEiR7kLywHp6cqs',
        matchId: '3f6582f0-808d-468b-b88f-e208aa56cff3',
        turnNumber: 8,
        slotIndex: 4,
      }),
      {
        digest: '3b90793c3b37c9ee4ae6bad1e17363b9a46c973bdcbb639671dfe90e9fb3f037',
        rewardKind: 'shield',
      },
    );
  });

  it('runtime-validates the complete authoritative Redis state', () => {
    const now = '2026-08-15T03:30:00.000Z';
    const matchId = '3f6582f0-808d-468b-b88f-e208aa56cff3';
    const entropySeed = Buffer.alloc(32, 1).toString('base64url');
    const players = GRID9_SLOT_INDICES.map(
      (slotIndex): Grid9SentinelPlayer => ({
        slotId: `slot-${slotIndex}`,
        slotIndex,
        kind: 'sentinel',
        sentinelId: `sentinel-${slotIndex}`,
        displayName: `Sentinel ${slotIndex}`,
        avatarUrl: null,
        feed: {
          kind: 'sentinel_render',
          characterId: `character-${slotIndex}`,
          animationSeed: slotIndex,
        },
        status: 'alive',
        mode: 'combatant',
        connectionState: 'not_applicable',
        health: GRID9_MAX_HEALTH,
        maxHealth: GRID9_MAX_HEALTH,
        shieldPoints: 0,
        maxShieldPoints: 100,
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
        joinedAt: now,
        eliminatedAt: null,
        eliminatedBy: null,
        lastDamagedAt: null,
        knockoutPayoutFaceCoins: 0,
        ai: {
          profileId: 'balanced-v1',
          targetStrategy: 'lowest_health',
          aggressionBps: 6000,
          shieldBelowHealth: 35,
          minimumReactionMs: 900,
          maximumReactionMs: 2200,
        },
      }),
    ) as Grid9PlayerSlots;
    const state: Grid9GameState = {
      schemaVersion: 1,
      game: 'grid9',
      matchId,
      liveSessionId: 'c29bbc4b-f65e-4b08-b1f0-e4df7c14d474',
      region: 'eu-west-2',
      roomMode: 'public',
      ownerUserId: null,
      roomCode: null,
      entryFeeCoins: 0,
      phase: 'combat',
      phaseStartedAt: now,
      phaseEndsAt: '2026-08-15T03:45:00.000Z',
      players,
      audienceCount: 0,
      turn: {
        turnNumber: 1,
        spotlightSlotIndex: 0,
        startedAt: now,
        spotlightEndsAt: '2026-08-15T03:30:30.000Z',
        endsAt: '2026-08-15T03:30:30.000Z',
        microDropAwarded: true,
        attacksUsedThisTurn: 0,
        defensesUsedThisTurn: 0,
        freeDropItemId: 'arrow',
        freeDropEquipped: false,
        autoResolved: false,
      },
      roulette: null,
      lastMicroDrop: null,
      lastAction: null,
      jackpot: {
        currency: 'coins',
        openingRolloverCoins: 0,
        houseSeedCoins: 100,
        openingRolloverClaimId: null,
        openingRolloverFenceToken: null,
        openingRolloverClaimStatus: 'none',
        purchaseContributionCoins: 0,
        currentCoins: 100,
        status: 'growing',
        rolloverSourceMatchId: null,
        rolloverDestinationMatchId: null,
        winnerSlotIndex: null,
        winnerUserId: null,
        winnerSentinelId: null,
        sponsorPassRecipientUserId: null,
      },
      outcome: null,
      settlement: {
        status: 'not_started',
        settlementId: null,
        winnerPayoutCoins: 0,
        rolloverCoins: 0,
        escrowReleaseCoins: 0,
        attemptCount: 0,
        lastAttemptAt: null,
        completedAt: null,
        errorCode: null,
      },
      rules: {
        rulesVersion: GRID9_RULES_VERSION,
        slotCount: 9,
        maxHealth: GRID9_MAX_HEALTH,
        maxShieldPoints: GRID9_MAX_SHIELD_POINTS,
        sentinelFillDelayMs: GRID9_SENTINEL_FILL_DELAY_MS,
        countdownMs: GRID9_COUNTDOWN_MS,
        publicLobbyMs: GRID9_PUBLIC_LOBBY_MS,
        rouletteDurationMs: GRID9_ROULETTE_DURATION_MS,
        turnDurationMs: GRID9_TURN_DURATION_MS,
        spotlightDurationMs: GRID9_SPOTLIGHT_DURATION_MS,
        maxMatchDurationMs: GRID9_MAX_MATCH_DURATION_MS,
        houseSeedCoins: 100,
        inventoryCapacity: 3,
        microDropCoinReward: GRID9_MICRO_DROP_COIN_REWARD,
        microDropShieldReward: GRID9_MICRO_DROP_SHIELD_REWARD,
        minEscrowReserveCoins: GRID9_MIN_ESCROW_RESERVE_COINS,
        maxEscrowReserveCoins: GRID9_MAX_ESCROW_RESERVE_COINS,
        minMercenaryFundCoins: GRID9_MIN_MERCENARY_FUND_COINS,
        maxMercenaryFundCoins: GRID9_MAX_MERCENARY_FUND_COINS,
      },
      authority: {
        stateVersion: 1,
        eventSequence: 1,
        entropySeed,
        entropyCommitment: grid9EntropyCommitment(matchId, entropySeed),
        nextTurnAt: '2026-08-15T03:30:05.000Z',
        matchDeadlineAt: '2026-08-15T03:45:00.000Z',
        cooldowns: {},
        proxyNextActionAt: {},
        mutationCount: 0,
        lastMutationAt: now,
      },
      createdAt: now,
      updatedAt: now,
      expiresAt: '2026-08-16T03:30:00.000Z',
    };

    assert.equal(parseGrid9GameState(state).players.length, 9);
    const legacy = structuredClone(state) as Grid9GameState;
    legacy.rules.rulesVersion = '2026-08-16.3';
    legacy.rules.rouletteDurationMs = 3500 as typeof GRID9_ROULETTE_DURATION_MS;
    assert.equal(
      parseGrid9GameState(legacy).rules.rouletteDurationMs,
      GRID9_ROULETTE_DURATION_MS,
    );
    assert.equal(parseGrid9GameState(legacy).rules.rulesVersion, GRID9_RULES_VERSION);
    const invalid = structuredClone(state) as Grid9GameState;
    invalid.players[8].slotIndex = 7;
    assert.throws(() => parseGrid9GameState(invalid), /slotIndex/);
  });

  it('keeps the documented canonical Redis JSON executable', () => {
    // Historical Phase-1 JSON sample in ARCHITECTURE.md is v1-shaped.
    // Wave 1 authority is covered by the runtime fixture + engine tests.
    assert.equal(GRID9_RULES_VERSION, '2026-08-16.8');
    assert.ok(
      readFileSync(resolve(process.cwd(), 'src/games/grid9/ARCHITECTURE.md'), 'utf8').includes(
        'Grid 9 v2',
      ),
    );
  });
});
