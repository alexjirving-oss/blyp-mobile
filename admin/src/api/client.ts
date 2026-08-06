// API client for the Blyp admin console.
// Talks to the blyp-live-service admin endpoints on Cloud Run with Cognito Bearer tokens.

import { CognitoMfaRequiredError, cognitoPasswordSignIn, type CognitoTokens } from "../auth/cognito";

const DEFAULT_API_BASE = "https://blyp-live-service-innn3d7yqq-uc.a.run.app";
const SESSION_KEY = "blypAdminSessionV3";

export interface AdminSession {
  apiBase: string;
  /** Cognito ID token (Bearer). */
  idToken: string;
  actorUserId: string;
  expiresAt: number;
}

export { CognitoMfaRequiredError };

export function getApiBase(): string {
  const s = loadSession();
  return s?.apiBase || DEFAULT_API_BASE;
}

export function loadSession(): AdminSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AdminSession;
    if (!parsed?.idToken) return null;
    if (parsed.expiresAt && parsed.expiresAt <= Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSession(session: AdminSession): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
  try {
    localStorage.removeItem("blypAdminSessionV2");
  } catch {
    /* ignore */
  }
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, ms = 20000): Promise<T> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fn(ctrl.signal);
  } finally {
    clearTimeout(id);
  }
}

async function exchangeAdminSession(
  tokens: CognitoTokens,
  apiBase: string
): Promise<AdminSession> {
  const res = await withTimeout((signal) =>
    fetch(apiBase + "/admin/auth/login", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.idToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
      signal,
    })
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      res.status,
      data?.detail || data?.code || data?.error || `Login failed (${res.status})`
    );
  }

  const session: AdminSession = {
    apiBase,
    idToken: tokens.idToken,
    actorUserId: String(data.actorUserId || tokens.sub),
    expiresAt: tokens.expiresAt,
  };
  saveSession(session);
  return session;
}

/** Cognito email/password → allowlisted admin session (Bearer ID token). */
export async function login(
  email: string,
  password: string,
  apiBase = DEFAULT_API_BASE
): Promise<AdminSession> {
  const tokens = await cognitoPasswordSignIn(email, password);
  return exchangeAdminSession(tokens, apiBase);
}

/**
 * Complete an MFA challenge started by login().
 * Pass the completeMfa fn from CognitoMfaRequiredError.
 */
export async function completeMfaLogin(
  completeMfa: (otpCode: string) => Promise<CognitoTokens>,
  otpCode: string,
  apiBase = DEFAULT_API_BASE
): Promise<AdminSession> {
  const tokens = await completeMfa(otpCode);
  return exchangeAdminSession(tokens, apiBase);
}

function onAuthExpired() {
  clearSession();
  if (typeof window !== "undefined") window.location.assign("/login");
}

async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const session = loadSession();
  if (!session) {
    onAuthExpired();
    throw new ApiError(401, "Not authenticated");
  }
  const res = await withTimeout((signal) =>
    fetch(session.apiBase + path, {
      method,
      headers: {
        Authorization: `Bearer ${session.idToken}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    })
  );
  if (res.status === 401) {
    onAuthExpired();
    throw new ApiError(401, "Session expired");
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new ApiError(res.status, data?.detail || data?.error || `HTTP ${res.status}`);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  /** Authenticated binary/text download (CSV export). */
  download: async (path: string, filename: string): Promise<void> => {
    const session = loadSession();
    if (!session) {
      onAuthExpired();
      throw new ApiError(401, "Not authenticated");
    }
    const res = await withTimeout((signal) =>
      fetch(session.apiBase + path, {
        method: "GET",
        headers: { Authorization: `Bearer ${session.idToken}` },
        signal,
      }),
      60000,
    );
    if (res.status === 401) {
      onAuthExpired();
      throw new ApiError(401, "Session expired");
    }
    if (!res.ok) {
      const text = await res.text();
      let detail = `HTTP ${res.status}`;
      try {
        const j = JSON.parse(text);
        detail = j?.detail || j?.error || detail;
      } catch {
        /* ignore */
      }
      throw new ApiError(res.status, detail);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
  health: async (): Promise<{ ok?: boolean; status?: string; ready?: boolean }> => {
    const res = await withTimeout((signal) => fetch(getApiBase() + "/health", { signal }));
    return res.json();
  },
};
