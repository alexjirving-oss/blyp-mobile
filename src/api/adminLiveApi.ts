/**
 * Mobile client for blyp-live-service /admin/* ops.
 *
 * Auth and UI entitlement: Cognito Bearer + server ADMIN_ALLOWLIST_SUBS/RBAC
 * (the same authority used by the dashboard and every mutating admin route).
 */

import { getCognitoJwtForApi } from './getCognitoJwtForApi';
import { resolveLiveServiceUrl } from './economyLiveApi';

/** Canonical 5-tier feed priority (post + account). Legacy `less` ≡ `low`. */
export type FeedPriority = 'suppress' | 'low' | 'standard' | 'high' | 'boost';
export type AccountFeedPriority = FeedPriority;
/** Accepted by the posts API (maps to low on write). */
export type FeedPriorityInput = FeedPriority | 'less';

export const FEED_PRIORITY_TIERS: Array<{
  value: FeedPriority;
  label: string;
  hint: string;
}> = [
  { value: 'suppress', label: 'Suppress', hint: 'Practically do not show' },
  { value: 'low', label: 'Low', hint: 'Decreased' },
  { value: 'standard', label: 'Standard', hint: 'Default' },
  { value: 'high', label: 'High', hint: 'Increased' },
  { value: 'boost', label: 'Boost', hint: 'Maximum priority' },
];

export type AdminAccess = {
  ok: boolean;
  actorUserId: string;
  role: string;
  roleDisplay?: string;
  permissions: string[];
  staffSource?: 'db' | 'bootstrap';
  displayName?: string | null;
};

async function callAdminBackend<T>(
  path: string,
  method: 'POST' | 'GET' = 'POST',
  body: Record<string, unknown> = {},
): Promise<T> {
  const baseUrl = resolveLiveServiceUrl();
  const token = await getCognitoJwtForApi({ tokenType: 'id', timeoutMs: 10000 });
  const url = `${baseUrl}${path}`;

  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }

  if (!res.ok) {
    const code = json?.code ? String(json.code) : '';
    const detail = json?.detail ? String(json.detail) : '';
    const base = json?.error || `Backend returned HTTP ${res.status}`;
    const err: any = new Error([base, code ? `[${code}]` : '', detail].filter(Boolean).join(' '));
    err.code = code || `HTTP_${res.status}`;
    err.status = res.status;
    err.detail = detail;
    throw err;
  }

  return json as T;
}

/**
 * Server-authoritative mobile entitlement check.
 *
 * Keeping visibility on the same endpoint that guards mutations prevents
 * Cognito/Firebase hydration races and stale Firestore role mirrors from hiding
 * valid controls (or showing them to a normal user).
 */
export async function getAdminAccess(): Promise<AdminAccess> {
  return callAdminBackend<AdminAccess>('/admin/auth/me', 'GET');
}

export async function adminBanUser(
  userId: string,
  opts: { reason?: string; bannedUntil?: string } = {},
): Promise<{ ok: boolean }> {
  const id = String(userId || '').trim();
  if (!id) throw new Error('missing userId');
  return callAdminBackend(`/admin/users/${encodeURIComponent(id)}/ban`, 'POST', {
    reason: opts.reason || 'Banned from mobile admin',
    ...(opts.bannedUntil ? { bannedUntil: opts.bannedUntil } : {}),
  });
}

export async function adminRemovePost(
  postId: string,
  opts: { reason?: string; userId?: string } = {},
): Promise<{ ok: boolean; isRemoved?: boolean }> {
  const id = String(postId || '').trim();
  if (!id) throw new Error('missing postId');
  const body: Record<string, unknown> = {
    reason: opts.reason || 'Removed from mobile admin',
  };
  if (opts.userId) body.userId = opts.userId;
  return callAdminBackend(`/admin/posts/${encodeURIComponent(id)}/remove`, 'POST', body);
}

export async function adminSetFeedPriority(
  postId: string,
  priority: FeedPriorityInput,
  opts: { reason?: string } = {},
): Promise<{ ok: boolean; feedPriority?: FeedPriority }> {
  const id = String(postId || '').trim();
  if (!id) throw new Error('missing postId');
  return callAdminBackend(`/admin/posts/${encodeURIComponent(id)}/feed-priority`, 'POST', {
    priority,
    reason: opts.reason || `Set feed priority to ${priority}`,
  });
}

export async function adminSetAccountFeedPriority(
  userId: string,
  priority: AccountFeedPriority,
  opts: { reason?: string } = {},
): Promise<{ ok: boolean; feedPriorityAccount?: AccountFeedPriority }> {
  const id = String(userId || '').trim();
  if (!id) throw new Error('missing userId');
  return callAdminBackend(`/admin/users/${encodeURIComponent(id)}/feed-priority`, 'POST', {
    priority,
    reason: opts.reason || `Set account feed priority to ${priority}`,
  });
}
