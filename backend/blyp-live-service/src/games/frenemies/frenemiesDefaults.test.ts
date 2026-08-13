import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings, nearestAutoDelayMs } from './frenemiesSettings';

describe('frenemies defaultSettings', () => {
  it('defaults to 15s spin, auto-continue OFF, 10 coin prizes, 60s auto delay, host pays', () => {
    const s = defaultSettings();
    assert.equal(s.spinMs, 15_000);
    assert.equal(s.autoContinue, false);
    assert.equal(s.autoContinueDelayMs, 60_000);
    assert.equal(s.housePays, false);
    assert.equal(s.throwCoins, 10);
    assert.equal(s.soloCoins, 10);
  });

  it('only enables autoContinue when explicitly true', () => {
    assert.equal(defaultSettings({ autoContinue: true }).autoContinue, true);
    assert.equal(defaultSettings({ autoContinue: false }).autoContinue, false);
    assert.equal(defaultSettings({ autoContinue: undefined }).autoContinue, false);
    assert.equal(defaultSettings({ autoContinue: null as any }).autoContinue, false);
    assert.equal(defaultSettings({ autoContinue: 1 as any }).autoContinue, false);
    assert.equal(defaultSettings({ autoContinue: 'true' as any }).autoContinue, false);
  });

  it('snaps spin to 10/15/20/30', () => {
    assert.equal(defaultSettings({ spinMs: 12_000 }).spinMs, 10_000);
    assert.equal(defaultSettings({ spinMs: 18_000 }).spinMs, 20_000);
    assert.equal(defaultSettings({ spinMs: 30_000 }).spinMs, 30_000);
  });

  it('snaps auto delay to 5/10/15/30/45/60', () => {
    assert.equal(nearestAutoDelayMs(3_000), 5_000);
    assert.equal(nearestAutoDelayMs(55_000), 60_000);
    assert.equal(defaultSettings({ autoContinueDelayMs: 58_000 }).autoContinueDelayMs, 60_000);
    assert.equal(defaultSettings({ autoContinueDelayMs: 12_000 }).autoContinueDelayMs, 10_000);
  });

  it('clamps coin rewards to 0..500', () => {
    assert.equal(defaultSettings({ throwCoins: 999 }).throwCoins, 500);
    assert.equal(defaultSettings({ soloCoins: -3 }).soloCoins, 0);
  });
});
