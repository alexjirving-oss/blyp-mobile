import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyGrid9MercenaryFunding,
  applyGrid9MicroDrop,
  applyGrid9Weapon,
  beginGrid9Combat,
  createGrid9Match,
  resolveGrid9Actor,
} from './grid9Engine';
import { toGrid9PublicGameState } from './grid9Projection';
import { parseGrid9GameState } from './schemas';

const alex = {
  userId: '26522274-e001-70aa-51b6-bcbbdffc43bb',
  publicProfileId: 'alex',
  displayName: 'Alex',
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
  return beginGrid9Combat(
    countdown,
    Date.parse('2026-08-15T03:30:03.000Z'),
  );
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
    assert.equal(result.state.players[4].health, 70);
    assert.equal(result.state.players[1].health, 92);
    assert.equal(result.state.jackpot.currentCoins, 25);
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
    assert.equal(result.state.jackpot.currentCoins, 0);
    assert.equal(result.state.players[2].topSupporters[0].userId, alex.userId);
  });

  it('awards one auditable micro-drop per spotlight turn', () => {
    const state = combatState();
    const result = applyGrid9MicroDrop({
      state,
      operationId: 'microdrop-turn-1',
      ledgerEntryId: 'ledger-microdrop-1',
      nowMs: Date.parse('2026-08-15T03:30:04.250Z'),
    });
    assert.equal(result.state.turn?.microDropAwarded, true);
    assert.equal(result.state.lastMicroDrop?.turnNumber, 1);
    assert.match(result.state.lastMicroDrop?.entropyDigest ?? '', /^[a-f0-9]{64}$/);
  });
});
