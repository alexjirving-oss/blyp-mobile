/**
 * Watch join plan: the live picture is the IVS Real-Time stage.
 * HLS is only a real program after server-side composition is ACTIVE.
 * A CreateChannel playbackUrl alone is not a watchable live.
 */

export type ViewerJoinPlan =
  | { transport: 'realtime' }
  | { transport: 'playback'; playbackUrl: string };

export function planViewerJoin(input: {
  preferPlayback?: boolean;
  compositionState?: string | null;
  playbackUrl?: string | null;
}): ViewerJoinPlan {
  if (!input.preferPlayback) {
    return { transport: 'realtime' };
  }
  const playbackUrl = String(input.playbackUrl || '').trim();
  const active = String(input.compositionState || '').toUpperCase() === 'ACTIVE';
  if (active && playbackUrl) {
    return { transport: 'playback', playbackUrl };
  }
  return { transport: 'realtime' };
}
