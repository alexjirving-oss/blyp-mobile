import {
  shouldSkipViewerLoudspeakerReassert,
  VIEWER_LOUDSPEAKER_MIN_INTERVAL_MS,
} from '../watchAudioPolicy';

describe('watchAudioPolicy', () => {
  it('allows the first viewer loudspeaker pin', () => {
    expect(shouldSkipViewerLoudspeakerReassert(0, 1_000)).toBe(false);
  });

  it('does not re-pin on the UI thread every Stage/player event', () => {
    expect(
      shouldSkipViewerLoudspeakerReassert(10_000, 10_000 + VIEWER_LOUDSPEAKER_MIN_INTERVAL_MS - 1),
    ).toBe(true);
    expect(
      shouldSkipViewerLoudspeakerReassert(10_000, 10_000 + VIEWER_LOUDSPEAKER_MIN_INTERVAL_MS),
    ).toBe(false);
  });
});
