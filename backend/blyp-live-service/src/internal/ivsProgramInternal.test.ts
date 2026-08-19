import '../live/testEnv';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mapCompositionEventName } from './ivsProgramEvents';

describe('ivs program EventBridge lookup contract', () => {
  it('composition ARN lives in resources[0], not used as a stage ARN', () => {
    const resources = ['arn:aws:ivs:eu-west-1:1:composition/abc'];
    const detail = { event_name: 'Destination Start', stage_arn: 'arn:aws:ivs:eu-west-1:1:stage/xyz' };
    assert.ok(resources[0].includes(':composition/'));
    assert.ok(detail.stage_arn.includes(':stage/'));
    assert.equal(mapCompositionEventName(detail.event_name), 'ACTIVE');
  });

  it('Session End does not map to a StartComposition trigger state', () => {
    assert.equal(mapCompositionEventName('Session End'), 'STOPPED');
    assert.notEqual(mapCompositionEventName('Session End'), 'FAILED');
  });
});
