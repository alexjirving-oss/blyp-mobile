import { getCognitoJwtForApi } from '../../api/getCognitoJwtForApi';
import { resolveLiveServiceUrl } from '../../api/economyLiveApi';

export type Grid9PublicMatchSummary = {
  matchId: string;
  phase: string;
  jackpotCoins: number;
  audienceCount: number;
  region: string;
  roomMode: 'public';
  survivors: number;
  entryFeeCoins: number;
  updatedAt: string;
};

/**
 * Auth'd browse of public active Grid 9 matches for Games hub.
 * Does not touch frozen LIVE directory services.
 */
export async function fetchPublicGrid9Matches(
  limit = 20,
): Promise<Grid9PublicMatchSummary[]> {
  const base = resolveLiveServiceUrl().replace(/\/$/, '');
  const token = await getCognitoJwtForApi({ tokenType: 'id' });
  const res = await fetch(`${base}/api/grid9/matches?limit=${Math.max(1, Math.min(40, limit))}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    throw new Error(String(json?.error || json?.message || `HTTP_${res.status}`));
  }
  const matches = Array.isArray(json?.matches) ? json.matches : [];
  return matches.map((row: any) => ({
    matchId: String(row.matchId || ''),
    phase: String(row.phase || ''),
    jackpotCoins: Math.max(0, Number(row.jackpotCoins || 0)),
    audienceCount: Math.max(0, Number(row.audienceCount || 0)),
    region: String(row.region || 'eu-west-2'),
    roomMode: 'public' as const,
    survivors: Math.max(0, Number(row.survivors || 0)),
    entryFeeCoins: Math.max(0, Number(row.entryFeeCoins || 0)),
    updatedAt: String(row.updatedAt || ''),
  })).filter((row: Grid9PublicMatchSummary) => row.matchId.length > 0);
}
