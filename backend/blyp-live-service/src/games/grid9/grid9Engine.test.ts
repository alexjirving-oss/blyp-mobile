import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GRID9_SENTINEL_MAX_REACTION_MS,
} from './constants';
import {
  applyGrid9ArsenalGift,
  applyGrid9InventoryBuy,
  applyGrid9MercenaryFunding,
  applyGrid9Shield,
  applyGrid9Weapon,
  advanceGrid9Turn,
  beginGrid9Combat,
  createGrid9Match,
  kickGrid9SeatToAudience,
  landGrid9Roulette,
  leaveGrid9SeatAsCombatant,
  resolveGrid9Actor,
  seatGrid9HumanInOpenLobby,
  startGrid9Roulette,
} from './grid9Engine';
import { timerOutboxForState } from './grid9MatchService';
import {
  chooseGrid9SentinelDecision,
  grid9CombatTimerDueAtMs,
  grid9SentinelReactionMs,
} from './grid9Sentinels';
import { toGrid9PublicGameState } from './grid9Projection';
import { parseGrid9GameState } from './schemas';
import type { Grid9HumanPlayer, Grid9SentinelPlayer } from './players';
const alex = {
  userId: '26522274-e001-70aa-51b6-bcbbdffc43bb',
  publicProfileId: 'alex',
  displayName: 'Alex',
  avatarUrl: null,
};
const blake = {
  userId: '36522274-e001-70aa-51b6-bcbbdffc43cc',
  publicProfileId: 'blake',
  displayName: 'Blake',
  avatarUrl: null,
};

function combatState() {
  const countdown = createGrid9Match({
    matchId: '3f6582f0-808d-468b-b88f-e208aa56cff3',
    liveSessionId: 'c29bbc4b-f65e-4b08-b1f0-e4df7c14d474',
    region: 'eu-west-2',
    humans: [
      {
        ...alex,
        queueTicketId: 'ticket-alex',
        sponsorPassId: null,
      },
    ],
    nowMs: Date.parse('2026-08-15T03:30:00.000Z'),
  });
  const state = beginGrid9Combat(
    countdown,
    Date.parse('2026-08-15T03:30:03.000Z'),
  );
  // Pin spotlight to the seeded human so paid-path tests stay deterministic.
  if (state.turn) {
    state.turn.spotlightSlotIndex = 0;
  }
  return state;
}

describe('Grid 9 authoritative engine', () => {
  it('creates exactly nine slots and strips private fields publicly', () => {
    const state = combatState();
    assert.equal(state.players.length, 9);
    assert.equal(state.players.filter((player) => player.kind === 'human').length, 1);
    assert.equal(state.players.filter((player) => player.kind === 'sentinel').length, 8);

    const publicState = toGrid9PublicGameState(state);
    const human = publicState.players[0];
    assert.equal(human.kind, 'human');
    assert.equal('userId' in human, false);
    assert.equal('queueTicketId' in human, false);
    assert.equal('ai' in publicState.players[1], false);
    assert.equal('entropySeed' in publicState, false);
  });

  it('resolves server-authoritative damage, cooldown, jackpot, and elimination', () => {
    const state = combatState();
    const { actor, sourceSlotIndex } = resolveGrid9Actor(state, alex);
    const result = applyGrid9Weapon({
      state,
      actor,
      sourceSlotIndex,
      weaponId: 'fireball',
      targetSlotIndex: 4,
      intentId: 'intent-fireball',
      serverOperationId: null,
      ledgerEntryId: 'ledger-fireball',
      payment: { kind: 'actor_escrow' },
      nowMs: Date.parse('2026-08-15T03:30:04.000Z'),
    });

    assert.deepEqual(
      result.damage.map((damage) => damage.slotIndex),
      [4, 1, 3, 5, 7],
    );
    assert.equal(result.state.players[4].health, 60);
    assert.equal(result.state.players[1].health, 90);
    assert.equal(result.state.jackpot.currentCoins, 112);
    assert.equal(result.state.authority.stateVersion, state.authority.stateVersion + 1);
    assert.equal(result.state.authority.eventSequence, state.authority.eventSequence + 1);
    assert.ok(result.state.authority.cooldowns[`user:${alex.userId}:fireball`]);
  });

  it('keeps one deterministic Last Stand survivor after an all-board wipe', () => {
    const state = combatState();
    for (const player of state.players) {
      player.health = 1;
      player.shieldPoints = 0;
    }
    const valid = parseGrid9GameState(state);
    const { actor, sourceSlotIndex } = resolveGrid9Actor(valid, alex);
    const result = applyGrid9Weapon({
      state: valid,
      actor,
      sourceSlotIndex,
      weaponId: 'mega_bomb',
      targetSlotIndex: 4,
      intentId: 'intent-mega',
      serverOperationId: null,
      ledgerEntryId: 'ledger-mega',
      payment: { kind: 'actor_escrow' },
      nowMs: Date.parse('2026-08-15T03:30:04.000Z'),
    });

    const survivors = result.state.players.filter((player) => player.status === 'alive');
    assert.ok(survivors.length >= 1);
    assert.equal(
      result.damage.filter((damage) => damage.lastStandApplied).length,
      result.damage.length === 9 ? 1 : 0,
    );
  });

  it('allows only an eliminated human to fund a surviving proxy', () => {
    const state = combatState();
    const human = state.players[0];
    assert.equal(human.kind, 'human');
    human.health = 0;
    human.status = 'eliminated';
    human.mode = 'sabotage';
    human.eliminatedAt = '2026-08-15T03:30:04.000Z';
    human.eliminatedBy = {
      kind: 'sentinel',
      sentinelId: 'sentinel-test',
      displayName: 'Sentinel Test',
    };
    const valid = parseGrid9GameState(state);
    const result = applyGrid9MercenaryFunding({
      state: valid,
      sponsor: alex,
      beneficiarySlotIndex: 2,
      amountCoins: 40,
      intentId: 'intent-fund',
      ledgerEntryId: 'ledger-fund',
      nowMs: Date.parse('2026-08-15T03:30:05.000Z'),
    });
    assert.equal(result.bankrollAfter, 40);
    assert.equal(result.state.players[2].mercenarySponsorCoins, 40);
    assert.equal(result.state.jackpot.currentCoins, 100);
    assert.equal(result.state.players[2].topSupporters[0].userId, alex.userId);
  });

  it('lands roulette with a weighted free drop on the selected seat', () => {
    const lobby = createGrid9Match({
      matchId: '3f6582f0-808d-468b-b88f-e208aa56cff3',
      liveSessionId: 'c29bbc4b-f65e-4b08-b1f0-e4df7c14d474',
      region: 'eu-west-2',
      humans: [
        {
          ...alex,
          queueTicketId: 'ticket-alex',
          sponsorPassId: null,
        },
      ],
      nowMs: Date.parse('2026-08-15T03:30:00.000Z'),
    });
    const spinning = startGrid9Roulette(
      lobby,
      Date.parse('2026-08-15T03:30:15.000Z'),
    );
    assert.equal(spinning.phase, 'roulette');
    assert.ok(spinning.roulette);
    const landed = landGrid9Roulette(
      spinning,
      Date.parse('2026-08-15T03:30:18.500Z'),
    );
    assert.equal(landed.phase, 'combat');
    assert.equal(landed.turn?.microDropAwarded, true);
    assert.ok(landed.turn?.freeDropItemId);
    assert.match(spinning.roulette?.entropyDigest ?? '', /^[a-f0-9]{64}$/);
  });

  it('rejects off-turn human combatant weapon fire', () => {
    const state = combatState();
    assert.ok(state.turn);
    state.turn.spotlightSlotIndex = 1;
    const { actor, sourceSlotIndex } = resolveGrid9Actor(state, alex);
    assert.throws(
      () =>
        applyGrid9Weapon({
          state,
          actor,
          sourceSlotIndex,
          weaponId: 'arrow',
          targetSlotIndex: 2,
          intentId: 'intent-offturn',
          serverOperationId: null,
          ledgerEntryId: 'ledger-offturn',
          payment: { kind: 'actor_escrow' },
          nowMs: Date.parse('2026-08-15T03:30:04.000Z'),
        }),
      /Only the active combatant may act/,
    );
  });

  it('consumes inventory without jackpot contribution', () => {
    const state = combatState();
    assert.ok(state.turn);
    state.players[0].inventory = ['arrow'];
    const beforeJackpot = state.jackpot.currentCoins;
    const { actor, sourceSlotIndex } = resolveGrid9Actor(state, alex);
    const result = applyGrid9Weapon({
      state,
      actor,
      sourceSlotIndex,
      weaponId: 'arrow',
      targetSlotIndex: 2,
      intentId: 'intent-inv',
      serverOperationId: null,
      ledgerEntryId: 'ledger-inv',
      payment: { kind: 'inventory' },
      nowMs: Date.parse('2026-08-15T03:30:04.000Z'),
    });
    assert.deepEqual(result.state.players[0].inventory, []);
    assert.equal(result.state.jackpot.currentCoins, beforeJackpot);
  });

  it('rejects audience arsenal fire', () => {
    const state = combatState();
    const audience = {
      userId: 'audience-1',
      publicProfileId: 'aud',
      displayName: 'Viewer',
      avatarUrl: null,
    };
    const { actor, sourceSlotIndex } = resolveGrid9Actor(state, audience);
    assert.equal(actor.kind, 'audience');
    assert.equal(sourceSlotIndex, null);
    assert.throws(
      () =>
        applyGrid9Weapon({
          state,
          actor,
          sourceSlotIndex,
          weaponId: 'arrow',
          targetSlotIndex: 2,
          intentId: 'intent-aud',
          serverOperationId: null,
          ledgerEntryId: 'ledger-aud',
          payment: { kind: 'actor_escrow' },
          nowMs: Date.parse('2026-08-15T03:30:04.000Z'),
        }),
      /Audience cannot fire arsenal/,
    );
  });

  it('grants arsenal gift into inventory with 70/30 split and FIFO overflow', () => {
    const state = combatState();
    const before = state.jackpot.currentCoins;
    const recipient = state.players[2];
    recipient.inventory = ['arrow', 'fireball', 'mega_bomb'];
    const result = applyGrid9ArsenalGift({
      state,
      sender: {
        userId: 'audience-1',
        publicProfileId: 'aud',
        displayName: 'Viewer',
        avatarUrl: null,
      },
      recipientSlotIndex: 2,
      itemId: 'basic_shield',
      intentId: 'intent-gift',
      ledgerEntryId: 'ledger-gift',
      nowMs: Date.parse('2026-08-15T03:30:04.000Z'),
    });
    assert.equal(result.costCoins, 15);
    assert.equal(result.seatCoins, 10);
    assert.equal(result.jackpotCoins, 5);
    assert.equal(result.state.jackpot.currentCoins, before + 5);
    assert.equal(result.state.players[2].mercenaryBankrollCoins, 10);
    assert.deepEqual(result.state.players[2].inventory, [
      'fireball',
      'mega_bomb',
      'basic_shield',
    ]);
    assert.equal(result.droppedItemId, 'arrow');
  });

  it('self-buy stocks inventory with same 70/30 accounting', () => {
    const state = combatState();
    const before = state.jackpot.currentCoins;
    const result = applyGrid9InventoryBuy({
      state,
      buyer: alex,
      itemId: 'arrow',
      intentId: 'intent-buy',
      ledgerEntryId: 'ledger-buy',
      nowMs: Date.parse('2026-08-15T03:30:04.000Z'),
    });
    assert.equal(result.selfBuy, true);
    assert.equal(result.seatCoins, 7);
    assert.equal(result.jackpotCoins, 3);
    assert.equal(result.state.jackpot.currentCoins, before + 3);
    assert.ok(result.state.players[0].inventory.includes('arrow'));
  });

  it('kick replaces seat with sentinel and bumps audience', () => {
    const lobby = createGrid9Match({
      matchId: 'kick-match-1',
      liveSessionId: 'kick-live-1',
      region: 'eu-west-2',
      roomMode: 'private',
      ownerUserId: alex.userId,
      roomCode: 'ABCD12',
      humans: [
        { ...alex, queueTicketId: 't1', sponsorPassId: null },
        {
          userId: 'guest-1',
          publicProfileId: 'guest',
          displayName: 'Guest',
          avatarUrl: null,
          queueTicketId: 't2',
          sponsorPassId: null,
        },
      ],
      nowMs: Date.parse('2026-08-15T03:30:00.000Z'),
    });
    const guest = lobby.players.find(
      (player) => player.kind === 'human' && player.userId === 'guest-1',
    );
    assert.ok(guest);
    const beforeAudience = lobby.audienceCount;
    const kicked = kickGrid9SeatToAudience(lobby, alex.userId, 'guest-1');
    assert.equal(kicked.state.players[guest.slotIndex].kind, 'sentinel');
    assert.equal(kicked.state.audienceCount, beforeAudience + 1);
  });

  it('leave seat replaces combatant with sentinel without bumping audience', () => {
    const state = combatState();
    const beforeAudience = state.audienceCount;
    const left = leaveGrid9SeatAsCombatant(state, alex.userId);
    assert.equal(left.state.players[0].kind, 'sentinel');
    assert.equal(left.state.audienceCount, beforeAudience);
    assert.equal(left.kickedSlotIndex, 0);
  });

  it('sentinel spotlight chooses inventory attack and advances turn', () => {
    const t0 = Date.parse('2026-08-15T04:00:00.000Z');
    let state = createGrid9Match({
      matchId: 'sentinel-auto-1',
      liveSessionId: 'sentinel-live-1',
      region: 'eu-west-2',
      humans: [{ ...alex, queueTicketId: 'ticket-alex', sponsorPassId: null }],
      nowMs: t0,
    });
    state = startGrid9Roulette(state, t0);
    assert.ok(state.roulette);
    const sentinelSlot = state.players.find((player) => player.kind === 'sentinel')!
      .slotIndex;
    state.roulette.selectedSlotIndex = sentinelSlot;
    state = landGrid9Roulette(state, t0 + 3_500);
    assert.equal(state.phase, 'combat');
    assert.equal(state.turn?.spotlightSlotIndex, sentinelSlot);

    const sentinel = state.players[sentinelSlot] as Grid9SentinelPlayer;
    assert.equal(sentinel.kind, 'sentinel');
    const reactionMs = grid9SentinelReactionMs(sentinel);
    assert.ok(reactionMs <= GRID9_SENTINEL_MAX_REACTION_MS);
    const dueMs = grid9CombatTimerDueAtMs(state)!;
    assert.ok(dueMs - Date.parse(state.turn!.startedAt) <= GRID9_SENTINEL_MAX_REACTION_MS);
    const timer = timerOutboxForState(state);
    assert.equal(timer?.reason, 'turn_end');
    assert.ok(
      Date.parse(timer!.dueAt) - Date.parse(state.turn!.startedAt) <=
        GRID9_SENTINEL_MAX_REACTION_MS,
    );

    const decision = chooseGrid9SentinelDecision(state, sentinel);
    assert.ok(decision, 'sentinel must decide without client intents');
    assert.ok(
      decision!.kind === 'weapon' || decision!.kind === 'shield',
      `expected weapon or shield, got ${decision!.kind}`,
    );

    let afterAct = state;
    if (decision!.kind === 'weapon') {
      const resolution = applyGrid9Weapon({
        state,
        actor: {
          kind: 'sentinel',
          sentinelId: sentinel.sentinelId,
          displayName: sentinel.displayName,
        },
        sourceSlotIndex: sentinelSlot,
        weaponId: decision.weaponId,
        targetSlotIndex: decision.targetSlotIndex,
        intentId: null,
        serverOperationId: `auto-sentinel-${state.turn!.turnNumber}`,
        ledgerEntryId: 'ledger-sentinel-auto',
        payment:
          decision.payment === 'mercenary_bankroll'
            ? {
                kind: 'mercenary_bankroll' as const,
                sourceSlotIndex: sentinelSlot,
              }
            : { kind: decision.payment },
        nowMs: Date.parse(state.turn!.startedAt) + reactionMs,
      });
      assert.equal(resolution.state.turn?.attacksUsedThisTurn, 1);
      assert.equal(resolution.state.lastAction?.kind, 'weapon');
      afterAct = resolution.state;
    } else if (decision!.kind === 'shield') {
      const resolution = applyGrid9Shield({
        state,
        actor: {
          kind: 'sentinel',
          sentinelId: sentinel.sentinelId,
          displayName: sentinel.displayName,
        },
        sourceSlotIndex: sentinelSlot,
        beneficiarySlotIndex: sentinelSlot,
        shieldId: decision.shieldId,
        intentId: null,
        serverOperationId: `auto-sentinel-shield-${state.turn!.turnNumber}`,
        ledgerEntryId: 'ledger-sentinel-auto-shield',
        payment:
          decision.payment === 'mercenary_bankroll'
            ? {
                kind: 'mercenary_bankroll' as const,
                sourceSlotIndex: sentinelSlot,
              }
            : { kind: decision.payment },
        nowMs: Date.parse(state.turn!.startedAt) + reactionMs,
      });
      assert.equal(resolution.state.lastAction?.kind, 'shield');
      afterAct = resolution.state;
    }

    const advanced = advanceGrid9Turn(
      afterAct,
      Date.parse(afterAct.turn!.endsAt),
    );
    assert.ok(
      advanced.phase === 'roulette' || advanced.phase === 'completed',
      `expected roulette/completed after sentinel act, got ${advanced.phase}`,
    );
  });

  it('open public lobby seats a second human into the same match', () => {
    const t0 = Date.parse('2026-08-16T04:00:00.000Z');
    let state = createGrid9Match({
      matchId: 'lobby-coalesce-1',
      liveSessionId: 'lobby-live-1',
      region: 'eu-west-2',
      humans: [{ ...alex, queueTicketId: 'ticket-alex', sponsorPassId: null }],
      nowMs: t0,
    });
    assert.equal(state.phase, 'lobby_waiting');
    assert.equal(state.rules.publicLobbyMs, 30_000);
    const seated = seatGrid9HumanInOpenLobby(
      state,
      { ...blake, queueTicketId: 'ticket-blake', sponsorPassId: null },
      t0 + 5_000,
    );
    assert.equal(seated.state.matchId, state.matchId);
    assert.equal(seated.state.players[seated.slotIndex].kind, 'human');
    assert.equal(
      (seated.state.players[seated.slotIndex] as Grid9HumanPlayer).userId,
      blake.userId,
    );
    const humans = seated.state.players.filter((p) => p.kind === 'human');
    assert.equal(humans.length, 2);
  });

  it('human attack ends combat timer immediately for next roulette', () => {
    const t0 = Date.parse('2026-08-16T05:00:00.000Z');
    let state = createGrid9Match({
      matchId: 'turn-end-1',
      liveSessionId: 'turn-live-1',
      region: 'eu-west-2',
      humans: [{ ...alex, queueTicketId: 'ticket-alex', sponsorPassId: null }],
      nowMs: t0,
    });
    state = startGrid9Roulette(state, t0);
    state.roulette!.selectedSlotIndex = 0;
    state = landGrid9Roulette(state, t0 + 3_500);
    assert.equal(state.turn?.spotlightSlotIndex, 0);
    const before = grid9CombatTimerDueAtMs(state)!;
    assert.ok(before - Date.parse(state.turn!.startedAt) > 5_000);

    state.players[0].inventory = ['arrow'];
    const resolution = applyGrid9Weapon({
      state,
      actor: {
        kind: 'human_player',
        userId: alex.userId,
        publicProfileId: alex.publicProfileId,
        displayName: alex.displayName,
      },
      sourceSlotIndex: 0,
      weaponId: 'arrow',
      targetSlotIndex: 1,
      intentId: 'intent-fire-1',
      serverOperationId: null,
      ledgerEntryId: 'ledger-fire-1',
      payment: { kind: 'inventory' },
      nowMs: Date.parse(state.turn!.startedAt) + 1_000,
    });
    assert.equal(resolution.state.turn?.attacksUsedThisTurn, 1);
    const due = grid9CombatTimerDueAtMs(resolution.state)!;
    assert.ok(
      due <= Date.now() + 50,
      'acted human turn must schedule immediate turn_end',
    );
    const advanced = advanceGrid9Turn(resolution.state, due);
    assert.ok(
      advanced.phase === 'roulette' || advanced.phase === 'completed',
      `expected immediate roulette after act, got ${advanced.phase}`,
    );
  });
});
