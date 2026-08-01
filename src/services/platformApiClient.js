import { getCanonicalAccessToken } from '../lib/auth/cognitoSession';

const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function createRequestId(prefix = 'req') {
  const random = Math.random().toString(36).slice(2, 12);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

function apiBaseUrl() {
  const value = String(process.env.EXPO_PUBLIC_API_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(value)) {
    const error = new Error('EXPO_PUBLIC_API_BASE_URL is not configured.');
    error.code = 'API_NOT_CONFIGURED';
    throw error;
  }
  return value;
}

function clientVersion() {
  return String(process.env.EXPO_PUBLIC_CLIENT_VERSION || '0.0.0-dev').trim() || '0.0.0-dev';
}

function retryDelayMs(attempt, response) {
  const retryAfter = Number(response?.headers?.get?.('Retry-After'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, 30_000);
  }
  return Math.min(500 * 2 ** attempt, 5000);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseResponseBody(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!contentType.includes('application/json')) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export class PlatformApiError extends Error {
  constructor({ status = 0, code = 'API_ERROR', message, details, correlationId, cause }) {
    super(message || 'The request could not be completed.');
    this.name = 'PlatformApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.correlationId = correlationId || null;
    this.cause = cause;
  }
}

export async function platformApiRequest(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const correlationId = options.correlationId || createRequestId('corr');
  const idempotencyKey = options.idempotencyKey || null;
  const canRetry = SAFE_METHODS.has(method) || Boolean(idempotencyKey);
  const maxRetries = canRetry ? Math.max(0, Math.min(options.retries ?? 2, 3)) : 0;
  const timeoutMs = Math.max(1000, Math.min(options.timeoutMs ?? 15_000, 60_000));
  const token = options.auth === false ? null : await getCanonicalAccessToken();
  const headers = {
    Accept: 'application/json',
    'X-Correlation-Id': correlationId,
    'X-Client-Version': clientVersion(),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    ...(options.headers || {}),
  };

  let body;
  if (options.body !== undefined && options.body !== null) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  const normalizedPath = String(path || '').startsWith('/') ? path : `/${path}`;
  const url = `${apiBaseUrl()}${normalizedPath}`;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body,
        signal: controller.signal,
      });
      const payload = await parseResponseBody(response);
      const responseCorrelationId =
        payload?.meta?.correlationId || response.headers.get('X-Correlation-Id') || correlationId;

      if (response.ok && payload?.ok === true) {
        return {
          data: payload.data,
          meta: payload.meta || { correlationId: responseCorrelationId },
          status: response.status,
        };
      }

      if (attempt < maxRetries && RETRYABLE_STATUS.has(response.status)) {
        await delay(retryDelayMs(attempt, response));
        continue;
      }

      throw new PlatformApiError({
        status: response.status,
        code: payload?.error?.code || 'API_RESPONSE_INVALID',
        message: payload?.error?.message || 'The server returned an invalid response.',
        details: payload?.error?.details,
        correlationId: responseCorrelationId,
      });
    } catch (error) {
      if (error instanceof PlatformApiError) throw error;
      const wasAborted = error?.name === 'AbortError';
      if (attempt < maxRetries) {
        await delay(retryDelayMs(attempt, response));
        continue;
      }
      throw new PlatformApiError({
        code: wasAborted ? 'API_TIMEOUT' : 'API_NETWORK_ERROR',
        message: wasAborted
          ? 'The request timed out. Please try again.'
          : 'The service could not be reached. Check your connection and try again.',
        correlationId,
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new PlatformApiError({
    code: 'API_RETRY_EXHAUSTED',
    message: 'The request could not be completed after retrying.',
    correlationId,
  });
}

export function createIdempotencyKey(operation = 'mutation') {
  return createRequestId(operation.replace(/[^a-z0-9_-]/gi, '-').slice(0, 32) || 'mutation');
}

export const platformApi = {
  get(path, options = {}) {
    return platformApiRequest(path, { ...options, method: 'GET' });
  },
    post(path, body, options = {}) {
    return platformApiRequest(path, { ...options, method: 'POST', body });
  },
  put(path, body, options = {}) {
    return platformApiRequest(path, { ...options, method: 'PUT', body });
  },
  patch(path, body, options = {}) {
    return platformApiRequest(path, { ...options, method: 'PATCH', body });
  },
  delete(path, options = {}) {

    return platformApiRequest(path, { ...options, method: 'DELETE' });
  },
};
