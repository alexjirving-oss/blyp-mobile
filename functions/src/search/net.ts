/**
 * Tiny fetch helpers for search providers: timeouts + safe JSON/text, so a slow
 * or broken supplier can never hang or crash a search request.
 */

import fetch from 'node-fetch';

const DEFAULT_TIMEOUT_MS = 6000;
const UA = 'BlypSearch/1.0 (+https://blyp.app)';

export interface ProviderRun {
  provider: string;
  results: import('../platform/types').NormalizedResult[];
  costMicros: number;
}

export async function fetchJson<T = any>(
  url: string,
  opts: { headers?: Record<string, string>; timeoutMs?: number } = {}
): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json', ...(opts.headers || {}) },
      signal: controller.signal as any,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchText(
  url: string,
  opts: { headers?: Record<string, string>; timeoutMs?: number } = {}
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, ...(opts.headers || {}) },
      signal: controller.signal as any,
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
