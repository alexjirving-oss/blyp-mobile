import './testEnv';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildMainFfmpegArgs,
  buildOutboundCopyArgs,
  planNeedsPortraitOutput,
} from './broadcastFfmpegPlan';
import {
  validateRtmpCredentials,
  buildRtmpPublishUrl,
  profileForPlatform,
  BROADCAST_PROVISIONING_ETA_SECONDS,
} from './broadcastRtmpValidate';
import {
  encryptBroadcastSecret,
  decryptBroadcastSecret,
} from './broadcastSecretCrypto';

describe('broadcastRtmpValidate', () => {
  it('accepts rtmps URLs and rejects probe-worthy invalid input', () => {
    const ok = validateRtmpCredentials('rtmps://live.example.com/app', 'abcd1234streamkey');
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.match(ok.rtmpUrl, /^rtmps:\/\//);
    }
    const bad = validateRtmpCredentials('https://not-rtmp', 'short');
    assert.equal(bad.ok, false);
  });

  it('rejects localhost RTMP ingest URLs', () => {
    const loop = validateRtmpCredentials('rtmp://127.0.0.1/live', 'abcd1234streamkey');
    assert.equal(loop.ok, false);
    if (!loop.ok) assert.equal(loop.code, 'INVALID_RTMP_URL');
    const named = validateRtmpCredentials('rtmp://localhost:1935/app', 'abcd1234streamkey');
    assert.equal(named.ok, false);
  });

  it('builds publish URL without double slashes', () => {
    const url = buildRtmpPublishUrl('rtmp://a.example.com/live', 'mykey');
    assert.equal(url, 'rtmp://a.example.com/live/mykey');
  });

  it('maps tiktok to portrait crop profile', () => {
    assert.equal(profileForPlatform('tiktok'), 'portrait_crop');
    assert.equal(profileForPlatform('youtube'), 'landscape_copy');
  });

  it('uses 45s provisioning fallback constant', () => {
    assert.equal(BROADCAST_PROVISIONING_ETA_SECONDS, 45);
  });
});

describe('broadcastFfmpegPlan', () => {
  it('uses copy for landscape relay and crop transcode for portrait relay', () => {
    const args = buildMainFfmpegArgs({
      hlsUrl: 'https://example.com/out.m3u8',
      landscapeRelayUrl: 'rtmp://127.0.0.1:1935/landscape/in',
      portraitRelayUrl: 'rtmp://127.0.0.1:1935/portrait/in',
    });
    const joined = args.join(' ');
    assert.match(joined, /-c:v copy/);
    assert.match(joined, /crop=ih\*9\/16:ih/);
    assert.match(joined, /libx264/);
    assert.match(joined, /landscape\/in/);
    assert.match(joined, /portrait\/in/);
  });

  it('outbound pusher uses copy only', () => {
    const args = buildOutboundCopyArgs({
      relayReadUrl: 'rtmp://127.0.0.1:1935/portrait/in',
      publishUrl: 'rtmp://push.tiktok.com/live/key',
    });
    assert.deepEqual(args.filter((a) => a === 'copy').length, 2);
  });

  it('detects portrait output need from platforms', () => {
    assert.equal(planNeedsPortraitOutput(['youtube', 'tiktok']), true);
    assert.equal(planNeedsPortraitOutput(['youtube']), false);
  });
});

describe('broadcastSecretCrypto', () => {
  it('round-trips RTMP secrets', () => {
    const prev = process.env.BROADCAST_SECRET_ENCRYPTION_KEY;
    process.env.BROADCAST_SECRET_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    try {
      const cipher = encryptBroadcastSecret({
        rtmpUrl: 'rtmp://x/live',
        streamKey: 'secret-key-12345',
      });
      const plain = decryptBroadcastSecret(cipher);
      assert.equal(plain.rtmpUrl, 'rtmp://x/live');
      assert.equal(plain.streamKey, 'secret-key-12345');
    } finally {
      if (prev === undefined) delete process.env.BROADCAST_SECRET_ENCRYPTION_KEY;
      else process.env.BROADCAST_SECRET_ENCRYPTION_KEY = prev;
    }
  });
});
