"use client";

import {
  forceRefreshSession,
  loadStoredSession,
  persistSession,
  refreshSessionIfNeeded,
} from "./cognito";
import { liveServiceUrl } from "./env";

export const SESSION_EXPIRED_MSG =
  "Session expired — log in again to Go LIVE";

function pickStr(...vals: unknown[]): string {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/** Map live-service / JWT failures to a clear re-login prompt. */
export function formatLiveAuthError(raw: string): string {
  const msg = String(raw || "").trim();
  if (
    /invalid token|jwt expired|token expired|unauthorized|missing or invalid authorization|session expired/i.test(
      msg,
    )
  ) {
    return SESSION_EXPIRED_MSG;
  }
  return msg || "Request failed";
}

async function resolveBearerToken(idToken: string): Promise<string> {
  const stored = loadStoredSession();
  if (!stored?.idToken) return idToken;
  const fresh = await refreshSessionIfNeeded(stored);
  return fresh?.idToken || stored.idToken || idToken;
}

/**
 * Authenticated live-service fetch with proactive Cognito refresh and one
 * 401 force-refresh retry. Matches economyFetch so Studio Go Live does not
 * die on a stale React session.idToken.
 */
export async function liveServiceFetch<T>(
  path: string,
  idToken: string,
  method: "GET" | "POST" = "POST",
  body?: Record<string, unknown>,
  query?: Record<string, string>,
  retried = false,
): Promise<T> {
  const token = retried ? idToken : await resolveBearerToken(idToken);
  const qs = query ? `?${new URLSearchParams(query).toString()}` : "";
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  if (method !== "GET") {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(`${liveServiceUrl}${path}${qs}`, {
    method,
    headers,
    body: method === "GET" ? undefined : JSON.stringify(body || {}),
    cache: "no-store",
  });
  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    if (res.status === 401 && !retried) {
      const stored = loadStoredSession();
      if (stored?.refreshToken) {
        const fresh = await forceRefreshSession(stored);
        if (fresh?.idToken) {
          return liveServiceFetch<T>(
            path,
            fresh.idToken,
            method,
            body,
            query,
            true,
          );
        }
      }
      persistSession(null);
      throw new Error(SESSION_EXPIRED_MSG);
    }
    // Prefer detail: routes often set error to a generic wrapper
    // (e.g. "Failed to invite guest") and put the real cause in detail.
    const errLabel = pickStr(payload.error);
    const detail = pickStr(payload.detail, payload.message);
    const genericInvite =
      /^failed to (invite guest|list guest requests|fetch guest)/i.test(errLabel);
    const raw =
      (genericInvite && detail ? detail : "") ||
      detail ||
      errLabel ||
      "";
    if (res.status === 401) {
      persistSession(null);
      throw new Error(formatLiveAuthError(raw || "Invalid token"));
    }
    throw new Error(raw || `HTTP ${res.status}`);
  }
  return payload as T;
}
