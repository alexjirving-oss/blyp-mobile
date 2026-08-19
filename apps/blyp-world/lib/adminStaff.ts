import { liveServiceUrl } from "./env";

/**
 * Same Cloud Run admin APIs as admin.blyp.world.
 * Auth is the signed-in Cognito ID token + server ADMIN_ALLOWLIST + RBAC.
 * Never treat a 403 as success.
 */

export type AdminStaffMe = {
  ok: boolean;
  actorUserId: string;
  authMode: string;
  role: string;
  roleDisplay: string;
  permissions: string[];
  staffSource?: string;
  displayName?: string | null;
};

export type AdminUserRow = {
  userId: string;
  username?: string;
  email?: string;
  displayName?: string;
  photoURL?: string | null;
  role: string;
  isBanned: boolean;
  banReason: string | null;
  bannedUntil: string | null;
};

export type AdminReportRow = {
  reportId: string;
  targetType: string;
  targetId: string;
  reporterId: string;
  reasonCode: string;
  details: string;
  status: string;
  surface: string | null;
  createdAt: string | null;
};

export class AdminStaffError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function pickStr(...vals: unknown[]): string {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

async function adminFetch<T>(
  path: string,
  idToken: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${liveServiceUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${idToken}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new AdminStaffError(
      res.status,
      pickStr(json.code, json.error) || `HTTP_${res.status}`,
      pickStr(json.detail, json.error, json.message) ||
        `Admin API ${res.status}`,
    );
  }
  return json as T;
}

export function staffCan(
  me: AdminStaffMe | null,
  permission: string,
): boolean {
  return !!me?.permissions?.includes(permission);
}

/** Probe allowlist + RBAC. 401/403 → not staff (null). Network errors throw. */
export async function fetchAdminStaffMe(
  idToken: string,
): Promise<AdminStaffMe | null> {
  try {
    return await adminFetch<AdminStaffMe>("/admin/auth/me", idToken, {
      method: "GET",
    });
  } catch (e) {
    if (e instanceof AdminStaffError && (e.status === 401 || e.status === 403)) {
      return null;
    }
    throw e;
  }
}

export async function searchAdminUsers(
  idToken: string,
  q: string,
): Promise<AdminUserRow[]> {
  const qs = new URLSearchParams({
    q: q.trim(),
    limit: "20",
    offset: "0",
  });
  const out = await adminFetch<{ items?: AdminUserRow[] }>(
    `/admin/users?${qs.toString()}`,
    idToken,
    { method: "GET" },
  );
  return Array.isArray(out.items) ? out.items : [];
}

export async function creditAdminCoins(
  idToken: string,
  userId: string,
  coins: number,
  reason: string,
): Promise<void> {
  await adminFetch(`/admin/users/${encodeURIComponent(userId)}/credit-coins`, idToken, {
    method: "POST",
    body: JSON.stringify({
      coins,
      reason: reason.trim() || undefined,
      idempotencyKey: `cc-${Date.now()}-${userId.slice(0, 8)}-${coins}`,
    }),
  });
}

export async function banAdminUser(
  idToken: string,
  userId: string,
  reason: string,
): Promise<void> {
  await adminFetch(`/admin/users/${encodeURIComponent(userId)}/ban`, idToken, {
    method: "POST",
    body: JSON.stringify({ reason: reason.trim() || null, bannedUntil: null }),
  });
}

export async function removeAdminPost(
  idToken: string,
  postId: string,
  reason: string,
): Promise<void> {
  await adminFetch(`/admin/posts/${encodeURIComponent(postId)}/remove`, idToken, {
    method: "POST",
    body: JSON.stringify({ reason: reason.trim() || undefined }),
  });
}

export async function listOpenAdminReports(
  idToken: string,
): Promise<{ available: boolean; reports: AdminReportRow[]; detail: string | null }> {
  const out = await adminFetch<{
    available?: boolean;
    reports?: AdminReportRow[];
    detail?: string | null;
  }>("/admin/reports?status=open&limit=20", idToken, { method: "GET" });
  return {
    available: out.available !== false,
    reports: Array.isArray(out.reports) ? out.reports : [],
    detail: out.detail || null,
  };
}
