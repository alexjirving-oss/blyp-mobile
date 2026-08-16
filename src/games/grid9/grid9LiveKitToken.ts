import { getCognitoJwtForApi } from '../../api/getCognitoJwtForApi';
import { resolveLiveServiceUrl } from '../../api/economyLiveApi';

export type Grid9LiveKitCreds = {
  url: string;
  token: string;
  room: string;
  participantId: string;
  canPublish: boolean;
};

/**
 * Mint a Grid9-scoped LiveKit token. Soft-fails (null) when server has no LIVEKIT_* —
 * spotlight falls back to SentinelStage / pending card. Never touches frozen IVS paths.
 */
export async function fetchGrid9LiveKitToken(
  matchId: string,
): Promise<Grid9LiveKitCreds | null> {
  const id = String(matchId || '').trim();
  if (!id) return null;
  try {
    const base = resolveLiveServiceUrl().replace(/\/$/, '');
    const token = await getCognitoJwtForApi({ tokenType: 'id' });
    const res = await fetch(`${base}/api/grid9/livekit-token`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ matchId: id }),
    });
    const json = (await res.json().catch(() => ({}))) as any;
    if (!res.ok || !json?.ok || !json?.url || !json?.token) {
      return null;
    }
    return {
      url: String(json.url),
      token: String(json.token),
      room: String(json.room || `grid9:${id}`),
      participantId: String(json.participantId || ''),
      canPublish: Boolean(json.canPublish),
    };
  } catch {
    return null;
  }
}
