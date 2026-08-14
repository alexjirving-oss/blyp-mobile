/**
 * @jest-environment node
 */

describe('livePublishAudioGuard', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('tracks publishing and any live path independently', () => {
    const guard = require('../src/services/livePublishAudioGuard');
    expect(guard.isLiveStagePublishing()).toBe(false);
    expect(guard.isLiveAudioSessionActive()).toBe(false);

    guard.setLiveAudioSessionActive(true);
    expect(guard.isLiveAudioSessionActive()).toBe(true);
    expect(guard.isLiveStagePublishing()).toBe(false);

    guard.setLiveStagePublishing(true);
    expect(guard.isLiveStagePublishing()).toBe(true);
    expect(guard.isLiveAudioSessionActive()).toBe(true);

    guard.setLiveStagePublishing(false);
    expect(guard.isLiveStagePublishing()).toBe(false);
    expect(guard.isLiveAudioSessionActive()).toBe(true);

    guard.setLiveAudioSessionActive(false);
    expect(guard.isLiveAudioSessionActive()).toBe(false);
  });

  it('treats publishing alone as live-active', () => {
    const guard = require('../src/services/livePublishAudioGuard');
    guard.setLiveStagePublishing(true);
    expect(guard.isLiveAudioSessionActive()).toBe(true);
  });
});
