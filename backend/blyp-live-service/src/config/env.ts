import dotenv from 'dotenv';

import { sanitizeAwsCredentialValue, sanitizeHeaderValue, headerValueDiagnostics } from '../utils/headerSanitize';
import { logger } from './logger';

dotenv.config();

function bootSanitizeEnv() {
  // Log only safe diagnostics (lengths/flags/char codes) — never raw values.
  const scanKeys: Array<{ key: 'AWS_ACCESS_KEY_ID' | 'AWS_SECRET_ACCESS_KEY' | 'AWS_SESSION_TOKEN' | 'AWS_REGION'; kind: 'aws-cred' | 'header' }> = [
    { key: 'AWS_ACCESS_KEY_ID', kind: 'aws-cred' },
    { key: 'AWS_SECRET_ACCESS_KEY', kind: 'aws-cred' },
    { key: 'AWS_SESSION_TOKEN', kind: 'aws-cred' },
    { key: 'AWS_REGION', kind: 'header' },
  ];

  const report: Record<string, unknown> = {};
  for (const { key, kind } of scanKeys) {
    const raw = process.env[key];
    const diag = headerValueDiagnostics(key, raw);
    const sanitized = kind === 'aws-cred' ? sanitizeAwsCredentialValue(raw) : sanitizeHeaderValue(raw);

    if (raw != null) {
      report[key] = {
        ...diag,
        sanitizedLength: sanitized.length,
        changed: sanitized !== String(raw),
      };

      if (sanitized !== String(raw)) {
        process.env[key] = sanitized;
      }
    } else {
      report[key] = {
        ...diag,
        sanitizedLength: 0,
        changed: false,
      };
    }
  }

  // Extra safety: sanitize additional env vars that influence AWS signing / URL building.
  const silentlySanitize = ['IVS_REALTIME_REGION', 'COGNITO_REGION', 'COGNITO_USER_POOL_ID'] as const;
  for (const key of silentlySanitize) {
    const raw = process.env[key];
    if (raw == null) continue;
    const sanitized = sanitizeHeaderValue(raw);
    if (sanitized !== String(raw)) {
      process.env[key] = sanitized;
    }
  }

  logger.info(report, '[AUTH_SANITIZE][BOOT_AWS_ENV_SCAN]');
}

bootSanitizeEnv();

export const ENV = {
  PORT: parseInt(process.env.PORT || '4000', 10),
  
  // AWS Regions
  AWS_REGION: process.env.AWS_REGION || 'eu-west-2',
  COGNITO_REGION: process.env.COGNITO_REGION || 'eu-west-2',
  IVS_REALTIME_REGION: process.env.IVS_REALTIME_REGION || 'eu-west-1',
  
  // Cognito
  COGNITO_USER_POOL_ID: process.env.COGNITO_USER_POOL_ID || 'eu-west-2_ITX07Zvnt',
  
  // DynamoDB Tables
  LIVE_SESSIONS_TABLE: process.env.LIVE_SESSIONS_TABLE || 'blyp_live_sessions',
  LIVE_GUESTS_TABLE: process.env.LIVE_GUESTS_TABLE || 'blyp_live_guests',
};

export default ENV;
