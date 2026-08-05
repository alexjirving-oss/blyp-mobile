import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRaceState,
  stepRace,
  applyCheerBoost,
  setPick,
  CHEER_BOOST_CAP,
} from './engine';

describe('marble engine', () => {
  it('runs lobby→lock→heat→podium deterministically', () => {
    let state = createRaceState({
      seed: 42,
      racers: [
        { userId: 'h', displayName: 'Host' },
        { userId: 'g1', displayName: 'G1' },
      ],
    });
    assert.equal(state.phase, 'lobby');
    state = setPick(state, 'viewer1', 'g1');
    assert.equal(state.picks.viewer1, 'g1');
    let guard = 0;
    while (state.phase !== 'heat' && guard++ < 500) state = stepRace(state);
    assert.equal(state.phase, 'heat');
    let a = state;
    let b = state;
    for (let i = 0; i < 20; i += 1) {
      a = stepRace(a);
      b = stepRace(b);
    }
    assert.deepEqual(
      a.marbles.map((m) => m.progress),
      b.marbles.map((m) => m.progress),
    );
    while (state.phase !== 'podium' && guard++ < 5000) state = stepRace(state);
    assert.equal(state.phase, 'podium');
    assert.ok(state.marbles.every((m) => m.place != null));
    assert.ok(Object.values(state.placePoints).some((p) => p > 0));
  });

  it('caps cheer boosts', () => {
    let state = createRaceState({
      seed: 7,
      racers: [
        { userId: 'h', displayName: 'Host' },
        { userId: 'g1', displayName: 'G1' },
      ],
    });
    while (state.phase !== 'heat') state = stepRace(state);
    for (let i = 0; i < CHEER_BOOST_CAP; i += 1) {
      const r = applyCheerBoost(state, 'g1');
      assert.equal(r.applied, true);
      state = r.state;
    }
    const blocked = applyCheerBoost(state, 'g1');
    assert.equal(blocked.applied, false);
    assert.equal(blocked.reason, 'CAP');
  });
});
