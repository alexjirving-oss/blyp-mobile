import type { NextFunction, Response } from 'express';
import type { AuthedRequest } from '../auth/cognitoJwtMiddleware';
import { writeAdminAudit } from '../admin/adminService';
import { getEconomyInfra } from '../economy/infra';

export const ANDROID_PLATFORM = 'android';
export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.blyp.mobile';

export type AppVersionPolicy = {
  enabled: boolean;
  minimumAndroidVersionCode: number | null;
  message: string;
  storeUrl: string;
  updatedAt: string | null;
};

export type AppVersionPolicyInput = {
  enabled: boolean;
  minimumAndroidVersionCode: number | null;
  message?: string;
  storeUrl?: string;
};

const POLICY_KEY = 'android';
const DEFAULT_POLICY: AppVersionPolicy = {
  enabled: false,
  minimumAndroidVersionCode: null,
  message: 'A newer version of BLYP is required to continue.',
  storeUrl: PLAY_STORE_URL,
  updatedAt: null,
};

function db() {
  return getEconomyInfra().db;
}

function asPositiveInteger(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(String(value || '').trim());
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function asIsoDate(value: unknown): string | null {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizePolicy(value: unknown): AppVersionPolicy {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const minimumAndroidVersionCode = asPositiveInteger(raw.minimumAndroidVersionCode);
  const enabled = Boolean(raw.enabled) && minimumAndroidVersionCode !== null;
  const message = typeof raw.message === 'string' && raw.message.trim()
    ? raw.message.trim().slice(0, 280)
    : DEFAULT_POLICY.message;
  const storeUrl = typeof raw.storeUrl === 'string' && /^https:\/\//i.test(raw.storeUrl.trim())
    ? raw.storeUrl.trim()
    : PLAY_STORE_URL;

  return {
    enabled,
    minimumAndroidVersionCode,
    message,
    storeUrl,
    updatedAt: asIsoDate(raw.updatedAt),
  };
}

export async function getAppVersionPolicy(): Promise<AppVersionPolicy> {
  try {
    const result = await db().raw(
      `SELECT enabled, minimum_android_version_code, message, store_url, updated_at
       FROM app_version_policy
       WHERE policy_key = ?
       LIMIT 1`,
      [POLICY_KEY],
    );
    const row = (result as any)?.rows?.[0];
    if (!row) return { ...DEFAULT_POLICY };

    return normalizePolicy({
      enabled: row.enabled,
      minimumAndroidVersionCode: row.minimum_android_version_code,
      message: row.message,
      storeUrl: row.store_url,
      updatedAt: row.updated_at,
    });
  } catch {
    // A temporary policy-storage failure must not lock every user out.
    return { ...DEFAULT_POLICY };
  }
}

export async function setAppVersionPolicy(input: {
  actorUserId: string;
  policy: AppVersionPolicyInput;
}): Promise<AppVersionPolicy> {
  const policy = normalizePolicy(input.policy);
  const current = {
    enabled: policy.enabled,
    minimumAndroidVersionCode: policy.minimumAndroidVersionCode,
    message: policy.message,
    storeUrl: policy.storeUrl,
  };

  await db().raw(
    `INSERT INTO app_version_policy (
       policy_key, enabled, minimum_android_version_code, message, store_url, updated_by_user_id, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT (policy_key) DO UPDATE SET
       enabled = EXCLUDED.enabled,
       minimum_android_version_code = EXCLUDED.minimum_android_version_code,
       message = EXCLUDED.message,
       store_url = EXCLUDED.store_url,
       updated_by_user_id = EXCLUDED.updated_by_user_id,
       updated_at = CURRENT_TIMESTAMP`,
    [
      POLICY_KEY,
      current.enabled,
      current.minimumAndroidVersionCode,
      current.message,
      current.storeUrl,
      input.actorUserId,
    ],
  );

  await writeAdminAudit({
    actorUserId: input.actorUserId,
    action: 'app_version_policy_set',
    targetType: 'config',
    targetId: POLICY_KEY,
    metadata: current,
  });

  return getAppVersionPolicy();
}

export function publicAppVersionPolicy(policy: AppVersionPolicy): AppVersionPolicy {
  return {
    enabled: policy.enabled,
    minimumAndroidVersionCode: policy.minimumAndroidVersionCode,
    message: policy.message,
    storeUrl: policy.storeUrl,
    updatedAt: policy.updatedAt,
  };
}

function headerValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? String(value[0] || '').trim() : String(value || '').trim();
}

/**
 * Enforce a configured Android minimum version on protected, authenticated
 * routers. The policy is off by default and fails open if its storage cannot be
 * queried, so a deployment cannot accidentally cause a global lockout.
 */
export async function requireSupportedAndroidVersion(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const policy = await getAppVersionPolicy();
    if (!policy.enabled || !policy.minimumAndroidVersionCode) {
      next();
      return;
    }

    const platform = headerValue(req.headers['x-blyp-platform']).toLowerCase();
    if (platform && platform !== ANDROID_PLATFORM) {
      next();
      return;
    }

    const currentVersionCode = asPositiveInteger(headerValue(req.headers['x-blyp-version-code']));
    if (currentVersionCode && currentVersionCode >= policy.minimumAndroidVersionCode) {
      next();
      return;
    }

    res.status(426).json({
      error: 'UPDATE_REQUIRED',
      code: 'UPDATE_REQUIRED',
      detail: policy.message,
      minimumAndroidVersionCode: policy.minimumAndroidVersionCode,
      storeUrl: policy.storeUrl,
    });
  } catch {
    next();
  }
}
