// API client for the Blyp admin console.
// Talks to the blyp-live-service admin endpoints on Cloud Run.

const DEFAULT_API_BASE = "https://blyp-live-service-innn3d7yqq-uc.a.run.app";
const SESSION_KEY = "blypAdminSessionV2";

export interface AdminSession {
  apiBase: string;
  sessionToken: string;
  actorUserId: string;
  expiresAt: number;
}

export function getApiBase(): string {
  const s = loadSession();
  return s?.apiBase || DEFAULT_API_BASE;
}

export function loadSession(): AdminSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AdminSession;
    if (!parsed?.sessionToken) return null;
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

export async function login(email: string, password: string, apiBase = DEFAULT_API_BASE): Promise<AdminSession> {
  const res = await withTimeout((signal) =>
    fetch(apiBase + "/admin/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      signal,
    })
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, data?.code || data?.error || `Login failed (${res.status})`);
  }
  const session: AdminSession = {
    apiBase,
    sessionToken: String(data.sessionToken),
    actorUserId: String(data.actorUserId || email),
    expiresAt: Date.now() + Number(data.expiresInMs || 8 * 60 * 60 * 1000),
  };
  saveSession(session);
  return session;
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
        "x-admin-session": session.sessionToken,
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
  health: async (): Promise<{ ok?: boolean; status?: string; ready?: boolean }> => {
    const res = await withTimeout((signal) => fetch(getApiBase() + "/health", { signal }));
    return res.json();
  },
};
