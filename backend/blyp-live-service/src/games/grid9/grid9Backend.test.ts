import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createGrid9CryptographicNonce } from './constants';
import {
  GRID9_AGGREGATE_COMMIT_LUA,
  grid9PaidCatalogJson,
} from './grid9AtomicScript';
import {
  GRID9_SHIELD_CATALOG,
  GRID9_WEAPON_CATALOG,
} from './catalog';
import { parseGrid9ClientIntent } from './grid9IntentSchemas';
import { grid9CanonicalIntentHash } from './canonical';
import { grid9ActionActorKey } from './players';

describe('Grid 9 Phase 2 backend contracts', () => {
  it('accepts a complete paid intent and rejects nullable match authority', () => {
    const intent = {
      protocol: 'grid9.ws',
      protocolVersion: 2,
      direction: 'client_to_server',
      messageId: 'message-1',
      connectionSessionId: 'connection-1',
      type: 'FIRE_WEAPON',
      matchId: 'match-1',
      intentId: 'intent-1',
      expectedStateVersion: 7,
      nonce: createGrid9CryptographicNonce(),
      sentAt: '2026-08-15T06:30:00.000Z',
      payload: { weaponId: 'arrow', targetSlotIndex: 4 },
    };
    assert.equal(parseGrid9ClientIntent(intent).type, 'FIRE_WEAPON');
    const selectTarget = {
      ...intent,
      type: 'SELECT_TARGET' as const,
      intentId: 'intent-select',
      payload: { targetSlotIndex: 4 },
    };
    assert.equal(parseGrid9ClientIntent(selectTarget).type, 'SELECT_TARGET');
    assert.throws(
      () => parseGrid9ClientIntent({ ...intent, matchId: null }),
      /Expected string/,
    );
    assert.throws(
      () => parseGrid9ClientIntent({ ...intent, nonce: 'predictable' }),
      /invalid nonce/,
    );
  });

  it('binds paid intent idempotency to authenticated identity', () => {
    const payload = { weaponId: 'arrow', targetSlotIndex: 4 };
    const first = grid9CanonicalIntentHash({
      authenticatedUserId: 'user-a',
      matchId: 'match-1',
      type: 'FIRE_WEAPON',
      payload,
    });
    const second = grid9CanonicalIntentHash({
      authenticatedUserId: 'user-b',
      matchId: 'match-1',
      type: 'FIRE_WEAPON',
      payload,
    });
    assert.notEqual(first, second);
  });

  it('keeps new paid commits read-only until one final aggregate HSET', () => {
    const writes = [
      ...GRID9_AGGREGATE_COMMIT_LUA.matchAll(
        /redis\.call\(['"](HSET|SET|DEL|INCR|DECR|HINCRBY|XADD)['"]/g,
      ),
    ].map((match) => match[1]);
    assert.deepEqual(writes, ['HSET', 'HSET']);
    assert.ok(
      GRID9_AGGREGATE_COMMIT_LUA.indexOf("redis.call('HSET'") <
        GRID9_AGGREGATE_COMMIT_LUA.indexOf("return reply('REPLAY'"),
      'the only early HSET consumes a nonce on an idempotent replay branch',
    );
    assert.ok(
      GRID9_AGGREGATE_COMMIT_LUA.lastIndexOf("redis.call('HSET'") >
        GRID9_AGGREGATE_COMMIT_LUA.indexOf('INSUFFICIENT_FUNDS'),
    );
  });

  it('injects paid catalog numbers from catalog.ts into Lua', () => {
    const injected = GRID9_AGGREGATE_COMMIT_LUA.match(
      /cjson\.decode\(\[=\[(.*?)\]=\]\)/s,
    );
    assert.ok(injected);
    assert.equal(injected[1], grid9PaidCatalogJson());
    const catalog = JSON.parse(injected[1]);
    for (const [id, item] of Object.entries(GRID9_WEAPON_CATALOG)) {
      assert.equal(catalog.weapons[id].cost, item.costCoins);
      assert.equal(catalog.weapons[id].jackpot, item.jackpotContributionCoins);
    }
    for (const [id, item] of Object.entries(GRID9_SHIELD_CATALOG)) {
      assert.equal(catalog.shields[id].cost, item.costCoins);
      assert.equal(catalog.shields[id].jackpot, item.jackpotContributionCoins);
    }
    assert.equal(
      GRID9_AGGREGATE_COMMIT_LUA.includes('arrow = { cost = 10'),
      false,
    );
  });

  it('uses collision-free cooldown keys for each actor class', () => {
    assert.equal(
      grid9ActionActorKey({
        kind: 'human_player',
        userId: 'u1',
        publicProfileId: 'alex',
        displayName: 'Alex',
      }),
      'user:u1',
    );
    assert.equal(
      grid9ActionActorKey({
        kind: 'sentinel',
        sentinelId: 's1',
        displayName: 'Sentinel',
      }),
      'sentinel:s1',
    );
    assert.equal(
      grid9ActionActorKey({
        kind: 'mercenary_proxy',
        sourceSlotIndex: 4,
        operationId: 'op1',
        displayName: 'Proxy',
      }),
      'proxy:4',
    );
  });
});
