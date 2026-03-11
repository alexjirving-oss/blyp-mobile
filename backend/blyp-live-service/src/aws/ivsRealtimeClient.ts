import { IVSRealTimeClient } from '@aws-sdk/client-ivs-realtime';
import { ENV } from '../config/env';
import { sanitizeAwsCredentialValue } from '../utils/headerSanitize';

const region = ENV.IVS_REALTIME_REGION;

if (!region) {
  throw new Error('[config] IVS_REALTIME_REGION is required for IVS Real-Time client');
}

const accessKeyId = process.env.AWS_ACCESS_KEY_ID ? sanitizeAwsCredentialValue(process.env.AWS_ACCESS_KEY_ID) : undefined;
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY
  ? sanitizeAwsCredentialValue(process.env.AWS_SECRET_ACCESS_KEY)
  : undefined;
const sessionToken = process.env.AWS_SESSION_TOKEN ? sanitizeAwsCredentialValue(process.env.AWS_SESSION_TOKEN) : undefined;

const hasStaticCredentials = !!(accessKeyId && secretAccessKey);

export const ivsRealtimeClient = new IVSRealTimeClient({
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


