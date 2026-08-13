import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateHouseMintCaps, getHouseMintCaps } from './houseGamePrizeMint';

describe('houseGamePrizeMint caps', () => {
  const caps = {
    maxPerAward: 500,
    maxPerUserPerDay: 2000,
    maxPerStream: 5000,
  };

  it('exposes default cap numbers (Frenemies-scale)', () => {
    const d = getHouseMintCaps();
    assert.equal(d.maxPerAward, 500);
    assert.equal(d.maxPerUserPerDay, 2000);
    assert.equal(d.maxPerStream, 5000);
  });

  it('uses RD-scale caps so 3× stake presets can mint', () => {
    const rd = getHouseMintCaps('reaction_duel');
    assert.equal(rd.maxPerAward, 15_000);
    assert.ok(rd.maxPerAward >= 500 * 3);
    assert.ok(rd.maxPerUserPerDay >= rd.maxPerAward);
    assert.ok(
      evaluateHouseMintCaps({
        amount: 750,
        userDayTotal: 0,
        streamTotal: 0,
        caps: rd,
      }).ok,
    );
  });

  it('allows a normal award under all caps', () => {
    assert.deepEqual(
      evaluateHouseMintCaps({ amount: 100, userDayTotal: 0, streamTotal: 0, caps }),
      { ok: true, amount: 100 },
    );
  });

  it('rejects over per-award cap', () => {
    const r = evaluateHouseMintCaps({ amount: 501, userDayTotal: 0, streamTotal: 0, caps });
    assert.equal(r.ok, false);
  });

  it('rejects when daily user total would exceed', () => {
    const r = evaluateHouseMintCaps({
      amount: 100,
      userDayTotal: 1950,
      streamTotal: 0,
      caps,
    });
    assert.equal(r.ok, false);
  });

  it('rejects when stream total would exceed', () => {
    const r = evaluateHouseMintCaps({
      amount: 100,
      userDayTotal: 0,
      streamTotal: 4950,
      caps,
    });
    assert.equal(r.ok, false);
  });
});
