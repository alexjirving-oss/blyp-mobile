import {
  GRID9_LOUDSPEAKER_REASSERT_MS,
  GRID9_LOUDSPEAKER_WATCHDOG_MS,
  burstGrid9Loudspeaker,
  grid9LiveKitAudioConfig,
  isGrid9LiveKitAudioActive,
  reassertGrid9Loudspeaker,
  startGrid9LoudspeakerGuard,
  stopGrid9LoudspeakerGuard,
} from '../grid9LiveKitAudio';

describe('grid9LiveKitAudio', () => {
  afterEach(async () => {
    await stopGrid9LoudspeakerGuard();
  });

  it('prefers speaker first and earpiece last on Android, speaker on iOS', () => {
    const cfg = grid9LiveKitAudioConfig();
    expect(cfg.android.preferredOutputList[0]).toBe('speaker');
    expect(cfg.android.preferredOutputList.at(-1)).toBe('earpiece');
    expect(cfg.android.audioTypeOptions.audioMode).toBe('inCommunication');
    expect(cfg.ios.defaultOutput).toBe('speaker');
  });

  it('uses the LIVE guest-join burst so Fold cannot keep the earpiece', () => {
    expect(GRID9_LOUDSPEAKER_REASSERT_MS).toEqual([400, 1200, 2800, 5000]);
    expect(GRID9_LOUDSPEAKER_WATCHDOG_MS).toBe(2000);
  });

  it('keeps the match latch on for first and later joiners until stop', async () => {
    expect(isGrid9LiveKitAudioActive()).toBe(false);
    startGrid9LoudspeakerGuard();
    expect(isGrid9LiveKitAudioActive()).toBe(true);
    burstGrid9Loudspeaker();
    reassertGrid9Loudspeaker();
    expect(isGrid9LiveKitAudioActive()).toBe(true);
    await stopGrid9LoudspeakerGuard();
    expect(isGrid9LiveKitAudioActive()).toBe(false);
    burstGrid9Loudspeaker();
    expect(isGrid9LiveKitAudioActive()).toBe(false);
  });
});
