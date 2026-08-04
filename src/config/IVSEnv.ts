/**
 * IVS Environment Configuration
 * 
 * Strongly typed accessors for Amazon IVS environment values.
 * Reads from Expo environment variables.
 */

type IVSEnvConfig = {
  region: string;
  // optional; we may move to per-stream dynamic resources later
  defaultStageArn?: string;
  defaultChannelArn?: string;
  // base URL or pattern for playback if needed
  playbackBaseUrl?: string;
};

const IVS_ENV: IVSEnvConfig = {
  region: process.env.EXPO_PUBLIC_IVS_REGION ?? 'us-east-1',
  defaultStageArn: process.env.EXPO_PUBLIC_IVS_DEFAULT_STAGE_ARN,
  defaultChannelArn: process.env.EXPO_PUBLIC_IVS_DEFAULT_CHANNEL_ARN,
  playbackBaseUrl: process.env.EXPO_PUBLIC_IVS_PLAYBACK_BASE_URL,
};

// Dev visibility: log resolved IVS region (safe for production as a single line)
console.log('[IVS_ENV]', { region: IVS_ENV.region });

export function getIVSEnv(): IVSEnvConfig {
  return IVS_ENV;
}
