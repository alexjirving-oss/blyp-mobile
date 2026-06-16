import { IVSRealTimeClient } from '@aws-sdk/client-ivs-realtime';
import { ENV } from '../config/env';
import { sanitizeAwsCredentialValue } from '../utils/headerSanitize';

// Default region for IVS Real-Time stages (used when no/invalid host hint is
// given, and for back-compat with the previously single-region setup).
export const DEFAULT_IVS_REALTIME_REGION = ENV.IVS_REALTIME_REGION;

if (!DEFAULT_IVS_REALTIME_REGION) {
  throw new Error('[config] IVS_REALTIME_REGION is required for IVS Real-Time client');
}

// Regions in which we are willing to create stages. A host close to one of these
// publishes to a nearby media server instead of always crossing to eu-west-1,
// which is what caused US hosts to fail/crash on go-live. Configurable via
// IVS_REALTIME_REGIONS (comma-separated) so ops can widen coverage without a
// code change; the default region is always allowed.
const ALLOWED_FROM_ENV = (process.env.IVS_REALTIME_REGIONS || 'eu-west-1,us-east-1,us-west-2')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export const ALLOWED_IVS_REALTIME_REGIONS = new Set<string>([
  DEFAULT_IVS_REALTIME_REGION.toLowerCase(),
  ...ALLOWED_FROM_ENV,
]);

const accessKeyId = process.env.AWS_ACCESS_KEY_ID ? sanitizeAwsCredentialValue(process.env.AWS_ACCESS_KEY_ID) : undefined;
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY
  ? sanitizeAwsCredentialValue(process.env.AWS_SECRET_ACCESS_KEY)
  : undefined;
const sessionToken = process.env.AWS_SESSION_TOKEN ? sanitizeAwsCredentialValue(process.env.AWS_SESSION_TOKEN) : undefined;

const hasStaticCredentials = !!(accessKeyId && secretAccessKey);

function buildClient(region: string): IVSRealTimeClient {
  return new IVSRealTimeClient({
    region,
    ...(hasStaticCredentials
      ? {
        credentials: {
          accessKeyId: accessKeyId as string,
          secretAccessKey: secretAccessKey as string,
          ...(sessionToken ? { sessionToken } : {}),
        },
      }
      : {}),
  });
}

// One client per region, created lazily and cached.
const clientsByRegion = new Map<string, IVSRealTimeClient>();

export function getIvsRealtimeClient(region?: string): IVSRealTimeClient {
  const r = (region && region.trim().toLowerCase()) || DEFAULT_IVS_REALTIME_REGION.toLowerCase();
  let client = clientsByRegion.get(r);
  if (!client) {
    client = buildClient(r);
    clientsByRegion.set(r, client);
  }
  return client;
}

/**
 * Resolve a host-provided region hint to a region we will actually create a
 * stage in. Falls back to the default region if the hint is missing or not in
 * the allowlist, so a bad/unknown hint can never break go-live.
 */
export function resolveStageRegion(hint?: string): string {
  const h = String(hint || '').trim().toLowerCase();
  if (h && ALLOWED_IVS_REALTIME_REGIONS.has(h)) return h;
  return DEFAULT_IVS_REALTIME_REGION;
}

/**
 * Extract the region from a stage ARN (arn:aws:ivs:<region>:<acct>:stage/<id>).
 * Participant tokens must be minted with a client in the SAME region as the
 * stage, so viewers/guests/joiners derive their client region from here.
 */
export function getRegionFromStageArn(arn?: string): string {
  if (!arn) return DEFAULT_IVS_REALTIME_REGION;
  const parts = String(arn).split(':');
  const region = parts.length > 3 ? parts[3].trim().toLowerCase() : '';
  return region || DEFAULT_IVS_REALTIME_REGION;
}

// Back-compat default client (default region). New code should prefer
// getIvsRealtimeClient(region) / getRegionFromStageArn(stageArn).
export const ivsRealtimeClient = getIvsRealtimeClient(DEFAULT_IVS_REALTIME_REGION);
