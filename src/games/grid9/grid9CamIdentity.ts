import type { Grid9PublicPlayer } from './protocol';

/** LiveKit identities a human seat may publish as (viewer subscribe must match one). */
export function grid9HumanCamIdentities(
  player: Grid9PublicPlayer | null | undefined,
): string[] {
  if (!player || player.kind !== 'human') return [];
  const ids: string[] = [];
  const push = (value: unknown) => {
    const next = String(value || '').trim();
    if (next && !ids.includes(next)) ids.push(next);
  };
  const feed = player.feed as { participantId?: string } | undefined;
  push(feed?.participantId);
  push((player as { userId?: string }).userId);
  push(player.publicProfileId);
  return ids;
}

export function grid9TrackMatchesCamIdentity(
  track: {
    participant?: { identity?: string; name?: string };
    publication?: { trackName?: string };
  } | null,
  identities: string[],
): boolean {
  if (!track || identities.length === 0) return false;
  const candidates = [
    track.participant?.identity,
    track.participant?.name,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return candidates.some((id) => identities.includes(id));
}
