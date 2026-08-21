import { planViewerJoin } from '../viewerJoinPlan';

describe('planViewerJoin', () => {
  it('uses the Real-Time stage unless HLS is explicitly preferred', () => {
    expect(
      planViewerJoin({
        preferPlayback: false,
        compositionState: 'ACTIVE',
        playbackUrl: 'https://example.com/live.m3u8',
      }),
    ).toEqual({ transport: 'realtime' });
  });

  it('does not treat a CreateChannel URL as a watchable live', () => {
    expect(
      planViewerJoin({
        preferPlayback: true,
        compositionState: 'UNKNOWN',
        playbackUrl: 'https://example.com/live.m3u8',
      }),
    ).toEqual({ transport: 'realtime' });
  });

  it('allows HLS only when composition is ACTIVE and a program URL exists', () => {
    expect(
      planViewerJoin({
        preferPlayback: true,
        compositionState: 'ACTIVE',
        playbackUrl: 'https://example.com/live.m3u8',
      }),
    ).toEqual({
      transport: 'playback',
      playbackUrl: 'https://example.com/live.m3u8',
    });
  });
});
