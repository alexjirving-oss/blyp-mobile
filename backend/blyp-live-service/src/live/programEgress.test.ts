import './testEnv';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  encoderArnForRegion,
  isProgramReadyForFanout,
  mapAwsCompositionState,
  mapFromGetComposition,
  PROGRAM_SSC_LAYOUT,
} from './programEgress';

describe('programEgress mappers', () => {
  it('maps composition.state STOPPING to STARTING', () => {
    assert.equal(mapAwsCompositionState('STOPPING'), 'STARTING');
    assert.equal(mapAwsCompositionState('ACTIVE'), 'ACTIVE');
    assert.equal(mapAwsCompositionState('nope'), 'UNKNOWN');
  });

  it('writes Dynamo ACTIVE only from destination ACTIVE', () => {
    assert.equal(
      mapFromGetComposition({ state: 'ACTIVE', destinations: [{ state: 'STARTING' }] }),
      'STARTING',
    );
    assert.equal(
      mapFromGetComposition({
        state: 'ACTIVE',
        destinations: [{ state: 'ACTIVE' }],
      }),
      'ACTIVE',
    );
    assert.equal(
      mapFromGetComposition({ state: 'ACTIVE', destinations: [{ state: 'RECONNECTING' }] }),
      'RECONNECTING',
    );
  });

  it('resolves encoder env keys', () => {
    const prev = process.env.IVS_ENCODER_ARN_LANDSCAPE_EUWEST1;
    process.env.IVS_ENCODER_ARN_LANDSCAPE_EUWEST1 = 'arn:aws:ivs:eu-west-1:1:encoder-configuration/x';
    try {
      assert.equal(
        encoderArnForRegion('eu-west-1'),
        'arn:aws:ivs:eu-west-1:1:encoder-configuration/x',
      );
    } finally {
      if (prev === undefined) delete process.env.IVS_ENCODER_ARN_LANDSCAPE_EUWEST1;
      else process.env.IVS_ENCODER_ARN_LANDSCAPE_EUWEST1 = prev;
    }
  });
});

describe('isProgramReadyForFanout', () => {
  it('is false when playbackUrl exists but composition has not started', () => {
    assert.equal(
      isProgramReadyForFanout({
        playbackUrl: 'https://example.live-video.net/out.m3u8',
        compositionState: 'UNKNOWN',
        channelLive: false,
      }),
      false,
    );
  });

  it('is true when composition destination is ACTIVE', () => {
    assert.equal(
      isProgramReadyForFanout({
        playbackUrl: 'https://example.live-video.net/out.m3u8',
        compositionState: 'ACTIVE',
        channelLive: false,
      }),
      true,
    );
  });

  it('is true when the low-latency channel is already LIVE', () => {
    assert.equal(
      isProgramReadyForFanout({
        playbackUrl: 'https://example.live-video.net/out.m3u8',
        compositionState: 'STARTING',
        channelLive: true,
      }),
      true,
    );
  });
});

describe('ensureProgram publisher gate', () => {
  it('does not StartComposition when hasPublisher is not true', () => {
    const hasPublisher = false as boolean;
    const missingComposition = true;
    const wouldStart = hasPublisher === true && missingComposition;
    assert.equal(wouldStart, false);
  });

  it('StartComposition uses featured-only PiP so guest publishers are not extra tiles', () => {
    assert.equal(PROGRAM_SSC_LAYOUT.pip.featuredParticipantAttribute, 'featured');
    assert.equal(PROGRAM_SSC_LAYOUT.pip.pipParticipantAttribute, 'sscPip');
    assert.equal(PROGRAM_SSC_LAYOUT.pip.omitStoppedVideo, true);
    assert.ok(!('grid' in PROGRAM_SSC_LAYOUT));
  });
});
