import { IvsClient } from '@aws-sdk/client-ivs';
import { ENV } from '../config/env';
import { sanitizeAwsCredentialValue } from '../utils/headerSanitize';

export const DEFAULT_IVS_LL_REGION = ENV.IVS_REALTIME_REGION;

if (!DEFAULT_IVS_LL_REGION) {
  throw new Error('[config] IVS_REALTIME_REGION is required for IVS low-latency client');
}

const accessKeyId = process.env.AWS_ACCESS_KEY_ID ? sanitizeAwsCredentialValue(process.env.AWS_ACCESS_KEY_ID) : undefined;
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY
  ? sanitizeAwsCredentialValue(process.env.AWS_SECRET_ACCESS_KEY)
  : undefined;
const sessionToken = process.env.AWS_SESSION_TOKEN ? sanitizeAwsCredentialValue(process.env.AWS_SESSION_TOKEN) : undefined;

const hasStaticCredentials = !!(accessKeyId && secretAccessKey);

function buildClient(region: string): IvsClient {
  return new IvsClient({
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

const clientsByRegion = new Map<string, IvsClient>();

export function getIvsLowLatencyClient(region?: string): IvsClient {
  const r = (region && region.trim().toLowerCase()) || DEFAULT_IVS_LL_REGION.toLowerCase();
  let client = clientsByRegion.get(r);
  if (!client) {
    client = buildClient(r);
    clientsByRegion.set(r, client);
  }
  return client;
}
