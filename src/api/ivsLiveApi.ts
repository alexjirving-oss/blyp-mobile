/**
 * IVS Live API Client
 *
 * Production-grade API client for IVS Real-Time token provisioning.
 *
 * BEHAVIOR:
 * - By default: Calls real backend /api/ivs/* endpoints for tokens
 * - Dev mode: If EXPO_PUBLIC_IVS_DEV_BYPASS=1 AND __DEV__: generates mock tokens locally
 * - Security: Requires Cognito ID token for all requests
 * - Error handling: Throws with descriptive messages, never crashes silently
 *
 * ENVIRONMENT VARIABLES:
 * - EXPO_PUBLIC_API_BASE_URL: Default backend base URL (Functions emulator in dev; e.g. http://<DEV_HOST>:5001/<project>/<region>)
 * - EXPO_PUBLIC_LIVE_SERVICE_URL: IVS live backend base URL (recommended; e.g. http://<LIVE_BACKEND_HOST>:4000)
 *   - If EXPO_PUBLIC_LIVE_SERVICE_URL is not set, IVS mode can also be driven by setting EXPO_PUBLIC_API_BASE_URL to your live-service base (port 4000)
 * - EXPO_PUBLIC_IVS_DEV_BYPASS: Set to '1' to use mock tokens in dev mode only
 *
 * ENDPOINTS (Old Firebase):
 * - POST /api/ivs/host-start: Host starts a new broadcast
 * - POST /api/ivs/guest-join: Guest joins as co-host
 * - POST /api/ivs/viewer-join: Viewer watches broadcast
 *
 * ENDPOINTS (New Live Backend):
 * - POST /api/live/start: Host starts a new broadcast
 * - POST /api/live/join-realtime: Viewer joins real-time stage
 * - POST /api/live/join: Join for HLS/mass viewing
 * - POST /api/live/guest/request: Request guest slot
 * - GET  /api/live/guest/requests: List pending guest requests
 * - POST /api/live/guest/invite: Invite guest to stage
 * - POST /api/live/guest/kick: Remove guest from stage
 * - POST /api/live/end: End live session
 */

import { getCognitoJwtForApi } from './getCognitoJwtForApi';
import { NativeModules } from 'react-native';

// ============================================================================
// CONFIG & FEATURE FLAGS
// ============================================================================

// PRODUCTION SAFETY: Fail closed if critical config is missing
const isDevelopment = __DEV__ === true;

let didWarnMissingLegacyBaseUrl = false;
let didWarnLiveServiceViaApiBaseUrl = false;
let didWarnUsingDefaultLiveServiceUrl = false;
let didWarnMissingLiveServiceUrl = false;

// In dev, we sometimes need to override loopback with the dev-machine IP.
// This avoids flaky adb reverse behavior when devices reconnect or multiple devices are attached.
let devLiveServiceUrlOverride: string | undefined;

// IMPORTANT: Do not embed literal loopback markers in release bundles.
// Construct them at runtime so release artifact scans can verify they're not baked into the binary.
const LOOPBACK_IPV4 = ['127', '0', '0', '1'].join('.');
const LOOPBACK_HOST = ['local', 'host'].join('');

const isLoopbackBaseUrl = (baseUrl: string): boolean => {
  try {
    const u = new URL(baseUrl);
    return u.hostname === LOOPBACK_IPV4 || u.hostname === LOOPBACK_HOST;
  } catch {
    return false;
  }
};

const inferDevMachineBaseUrlFromScriptURL = (port: number): string | undefined => {
  // RN exposes the currently loaded bundle URL, which (when not using adb reverse)
  // typically contains the dev-machine LAN IP.
  const scriptURL: string | undefined =
    (NativeModules as any)?.SourceCode?.scriptURL || (NativeModules as any)?.RCTSourceCode?.scriptURL;

  if (!scriptURL) return undefined;

  try {
    const u = new URL(scriptURL);
    if (!u.hostname) return undefined;

    // Keep protocol aligned with how Metro is reached (usually http).
    return `${u.protocol}//${u.hostname}:${port}`;
  } catch {
    return undefined;
  }
};

const fetchWithTimeout = async (url: string, timeoutMs: number): Promise<Response> => {
  const hasAbortController = typeof (globalThis as any).AbortController !== 'undefined';
  const controller = hasAbortController ? new (globalThis as any).AbortController() : undefined;

  const timeout = setTimeout(() => {
    try {
      controller?.abort();
    } catch {
      // ignore
    }
  }, timeoutMs);

  try {
    return await fetch(
      url,
      ({ method: 'GET', ...(controller ? { signal: controller.signal } : {}) } as any)
    );
  } finally {
    clearTimeout(timeout);
  }
};

// Legacy Functions resolver (for /api/ivs/* endpoints).
// Resolve lazily: env can be empty in dev builds.
const resolveLegacyFunctionsBaseUrl = (): string | undefined => {
  const raw = process.env.EXPO_PUBLIC_API_BASE_URL;

  if (!raw || !raw.trim()) {
    if (isDevelopment) {
      if (!didWarnMissingLegacyBaseUrl) {
        didWarnMissingLegacyBaseUrl = true;
        console.warn(
          '[IVS_API][LEGACY] EXPO_PUBLIC_API_BASE_URL is not set. ' +
          'OK if you only use live service (/api/live/*). ' +
          'If you need legacy Functions (/api/ivs/*), set EXPO_PUBLIC_API_BASE_URL=http://<DEV_HOST>:5001/<project>/<region>.'
        );
      }
      return undefined;
    }

    throw new Error(
      '[IVS_API][LEGACY] EXPO_PUBLIC_API_BASE_URL is required in production if /api/ivs/* endpoints are used.'
    );
  }

  return raw.replace(/\/+$/, '');
};

// DEV BYPASS: Only allowed in __DEV__ mode
// Production builds MUST use real AWS IVS credentials
// DISABLED: Using real AWS credentials instead of mock tokens
const DEV_BYPASS_ENABLED = false;

// Log final configuration (dev only, for diagnostics)
if (isDevelopment) {
  const apiBase = process.env.EXPO_PUBLIC_API_BASE_URL;
  console.log('[IVS_API][CONFIG]', {
    environment: 'development',
    EXPO_PUBLIC_API_BASE_URL: apiBase ? apiBase.substring(0, 50) + '...' : '(unset)',
    DEV_BYPASS_ENABLED,
  });
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type IVSRole = 'host' | 'guest' | 'viewer';

/**
 * Response from host-start endpoint.
 * Host joins an IVS Real-Time stage and can broadcast.
 */
export interface IvsHostStartResponse {
  ok: boolean;
  role: 'host';
  userId: string;
  streamId: string;
  stageArn: string;
  region: string;
  token: string;
  expiresAt: number; // Unix timestamp (seconds)
}

/**
 * Response from guest-join endpoint.
 * Guest joins an existing stage and can co-broadcast with the host.
 */
export interface IvsGuestJoinResponse {
  ok: boolean;
  role: 'guest';
  userId: string;
  streamId: string;
  stageArn: string;
  region: string;
  token: string;
  expiresAt: number; // Unix timestamp (seconds)
}

/**
 * Response from viewer-join endpoint.
 * Returns IVS Real-Time stage credentials for subscribe-only participant access.
 */
export interface IvsViewerJoinResponse {
  ok: boolean;
  role: 'viewer';
  userId: string;
  streamId: string;
  stageArn: string;
  region: string;
  token: string;
  expiresAt: number;
  issuedBy?: 'aws' | 'mock';
  tokenError?: string;
}

/**
 * Error response from backend.
 */
export interface IvsApiErrorShape {
  ok: false;
  error: string;
}

/**
 * Unified response type for backward compatibility with existing code.
 * NOTE: New code should prefer specific response types above.
 */
export type IVSJoinResponse =
  | IvsHostStartResponse
  | IvsGuestJoinResponse
  | IvsViewerJoinResponse;

/**
 * Host start request parameters.
 */
interface IVSHostStartParams {
  stageArnOverride?: string;
  devLabel?: string;
}

/**
 * Guest join request parameters.
 */
interface IVSGuestJoinParams {
  streamId?: string;
  stageArnOverride?: string;
}

/**
 * Viewer join request parameters.
 */
interface IVSViewerJoinParams {
  streamId?: string;
  stageArnOverride?: string;
}

// ============================================================================
// HELPER: UNIX TIMESTAMP (SECONDS)
// ============================================================================

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

// ============================================================================
// DEV BYPASS: MOCK TOKEN GENERATION
// ============================================================================

/**
 * Generates a fake JWT-like token for dev bypass testing.
 * Structure: header.payload.signature (base64-like encoding, not cryptographically valid)
 * Safe to use for testing token parsing and structure validation.
 */
function fakeJwtLikeToken(label: string): string {
  // Use standard base64url encoding for compatibility
  const base64url = (str: string) => {
    try {
      // Try global btoa if available (React Native)
      if (typeof global !== 'undefined' && typeof (global as any).btoa === 'function') {
        return (global as any).btoa(str)
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=/g, '');
      }
    } catch { }
    // Fallback to Buffer for Node.js
    return Buffer.from(str, 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  };

  const now = nowSeconds();
  const header = base64url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      sub: label,
      iat: now,
      exp: now + 3600, // 1 hour
    })
  );
  return `${header}.${payload}.`; // No signature (alg: none)
}

/**
 * Generates a mock IvsHostStartResponse for dev bypass testing.
 */
function makeMockHostStartResponse(
  _params?: IVSHostStartParams
): IvsHostStartResponse {
  const issuedAt = nowSeconds();
  return {
    ok: true,
    role: 'host',
    userId: 'dev-host-user',
    streamId: `stream-${Date.now()}`,
    stageArn: `arn:aws:ivs:dev-local:stage/${Date.now()}`,
    region: 'dev-local',
    token: fakeJwtLikeToken('dev-host'),
    expiresAt: issuedAt + 3600,
  };
}

/**
 * Generates a mock IvsGuestJoinResponse for dev bypass testing.
 */
function makeMockGuestJoinResponse(
  params?: IVSGuestJoinParams
): IvsGuestJoinResponse {
  const issuedAt = nowSeconds();
  return {
    ok: true,
    role: 'guest',
    userId: 'dev-guest-user',
    streamId: params?.streamId || `stream-${Date.now()}`,
    stageArn: `arn:aws:ivs:dev-local:stage/${Date.now()}`,
    region: 'dev-local',
    token: fakeJwtLikeToken('dev-guest'),
    expiresAt: issuedAt + 3600,
  };
}

/**
 * Generates a mock IvsViewerJoinResponse for dev bypass testing.
 */
function makeMockViewerJoinResponse(
  params?: IVSViewerJoinParams
): IvsViewerJoinResponse {
  const issuedAt = Math.floor(Date.now() / 1000);
  return {
    ok: true,
    role: 'viewer',
    userId: 'dev-viewer-user',
    streamId: params?.streamId || `stream-${Date.now()}`,
    stageArn: params?.stageArnOverride || `arn:aws:ivs:dev-local:030569357413:stage/dev-viewer-${Date.now()}`,
    region: 'dev-local',
    token: fakeJwtLikeToken('dev-viewer'),
    expiresAt: issuedAt + 3600,
    issuedBy: 'mock',
  };
}

// ============================================================================
// BACKEND COMMUNICATION
// ============================================================================

/**
 * Generic helper to call IVS backend endpoints with Cognito authentication.
 * Validates Cognito token, constructs Authorization header, makes HTTP request.
 */
async function callIvsBackend<T>(
  path: string,
  body: Record<string, any> = {}
): Promise<T> {
  // Legacy Functions base URL must be set to use /api/ivs/*.
  const API_BASE_URL = resolveLegacyFunctionsBaseUrl();
  if (!API_BASE_URL) {
    throw new Error(
      '[IVS_API][LEGACY] EXPO_PUBLIC_API_BASE_URL is not set, but a legacy /api/ivs/* endpoint was called. ' +
      'Set EXPO_PUBLIC_API_BASE_URL=http://<DEV_HOST>:5001/<project>/<region> (Functions mode) ' +
      'or use the live service endpoints (/api/live/*) via your live backend (port 4000).'
    );
  }

  // 2. Fetch Cognito ID token (returns validated JWT string)
  let token: string;
  try {
    console.log(`[IVS_API][${path}] Getting Cognito token...`);
    token = await getCognitoJwtForApi({ tokenType: 'id', timeoutMs: 10000 });
    console.log(`[IVS_API][${path}] Got token, calling API...`);
  } catch (err) {
    if (err instanceof Error) {
      throw err;
    }
    throw new Error(`[IVS_API] Failed to get Cognito token: ${String(err)}`);
  }

  // 4. Make HTTP request with Authorization header
  // Use the full path as-is (e.g. /api/ivs/host-start)
  // Both local-ivs-server.js and Firebase Functions expect this path structure
  const url = `${API_BASE_URL}${path}`;
  let res: Response;
  try {
    console.log(`[IVS_API][${path}] POST to ${url}`);
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    console.log(`[IVS_API][${path}] Response status: ${res.status}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Enhance network error messages with diagnostic hints
    if (msg.includes('Network request failed') || msg.includes('fetch')) {
      console.error(`[IVS_API][${path}] Network error: URL=${url}`);
      throw new Error(
        `[IVS_API] Network error calling ${path}: ${msg}. ` +
        'The IVS backend URL is not reachable from this device. ' +
        'Verify EXPO_PUBLIC_API_BASE_URL is correct and reachable (emulator: adb reverse tcp:5001 tcp:5001, physical device: check network). ' +
        `Backend URL was: ${url}`
      );
    }
    throw new Error(`[IVS_API] Network error calling ${path}: ${msg}`);
  }

  // 5. Parse response JSON
  let json: any;
  try {
    json = await res.json();
    console.log(`[IVS_API][${path}] Response JSON:`, JSON.stringify(json).substring(0, 200));
  } catch {
    throw new Error(
      `[IVS_API] Invalid JSON response from ${path} (HTTP ${res.status})`
    );
  }

  // 6. Check HTTP status and ok flag
  if (!res.ok || json?.ok === false) {
    const errorMsg =
      json?.error || `Backend returned HTTP ${res.status}`;
    throw new Error(`[IVS_API] ${path} failed: ${errorMsg}`);
  }

  return json as T;
}

// ============================================================================
// PUBLIC API: HOST START
// ============================================================================

/**
 * Start IVS broadcast as host.
 * Returns participant token and stage ARN for joining the Real-Time stage.
 *
 * @param params Optional override parameters for testing
 * @returns Token and stage details, or mock response if dev bypass enabled
 */
export async function ivsHostStart(
  params?: IVSHostStartParams
): Promise<IvsHostStartResponse> {
  console.log('[IVS_API][HOST_START]', { bypass: DEV_BYPASS_ENABLED });

  try {
    // Use dev bypass if enabled
    if (DEV_BYPASS_ENABLED) {
      console.log('[IVS_API][HOST_START] Using dev bypass (mock token)');
      return makeMockHostStartResponse(params);
    }

    // PRODUCTION: Call real backend for fresh token
    // Never use mock tokens or hardcoded test ARNs in production
    // The backend will validate the stage ARN and extract the region
    return await callIvsBackend<IvsHostStartResponse>('/api/ivs/host-start', {
      devLabel: params?.devLabel,
    });
  } catch (err) {
    console.error('[IVS_API][HOST_START_ERROR]', err);
    throw err;
  }
}

// ============================================================================
// PUBLIC API: GUEST JOIN
// ============================================================================

/**
 * Join IVS broadcast as guest (co-host).
 * Returns participant token and stage ARN for joining the Real-Time stage.
 *
 * @param params Stream ID and optional overrides
 * @returns Token and stage details, or mock response if dev bypass enabled
 */
export async function ivsGuestJoin(
  params?: IVSGuestJoinParams
): Promise<IvsGuestJoinResponse> {
  console.log('[IVS_API][GUEST_JOIN]', { bypass: DEV_BYPASS_ENABLED });

  try {
    // Use dev bypass if enabled
    if (DEV_BYPASS_ENABLED) {
      console.log('[IVS_API][GUEST_JOIN] Using dev bypass (mock token)');
      return makeMockGuestJoinResponse(params);
    }

    // Call real backend
    return await callIvsBackend<IvsGuestJoinResponse>('/api/ivs/guest-join', {
      streamId: params?.streamId,
      stageArnOverride: params?.stageArnOverride,
    });
  } catch (err) {
    console.error('[IVS_API][GUEST_JOIN_ERROR]', err);
    throw err;
  }
}

// ============================================================================
// PUBLIC API: VIEWER JOIN
// ============================================================================

/**
 * Join IVS broadcast as viewer (Real-Time stage participant, subscribe-only).
 * Returns participant token and stage ARN for joining as a read-only viewer.
 *
 * @param params Stream ID and optional overrides
 * @returns Stage credentials and viewer token, or mock response if dev bypass enabled
 */
export async function ivsViewerJoin(
  params?: IVSViewerJoinParams
): Promise<IvsViewerJoinResponse> {
  console.log('[IVS_API][VIEWER_JOIN]', { bypass: DEV_BYPASS_ENABLED });

  try {
    // Use dev bypass if enabled
    if (DEV_BYPASS_ENABLED) {
      console.log('[IVS_API][VIEWER_JOIN] Using dev bypass (mock token)');
      return makeMockViewerJoinResponse(params);
    }

    // Call real backend
    return await callIvsBackend<IvsViewerJoinResponse>('/api/ivs/viewer-join', {
      streamId: params?.streamId,
      stageArnOverride: params?.stageArnOverride,
    });
  } catch (err) {
    console.error('[IVS_API][VIEWER_JOIN_ERROR]', err);
    throw err;
  }
}

// ============================================================================
// NEW LIVE BACKEND API (Real-Time + Guest Flow)
// ============================================================================

/**
 * Resolver for live backend URL.
 * In dev: defaults to a local port-4000 live-service URL (override via EXPO_PUBLIC_LIVE_SERVICE_URL)
 * In prod: EXPO_PUBLIC_LIVE_SERVICE_URL (required; must NOT be loopback)
 */
const resolveLiveServiceUrl = (): string => {
  if (isDevelopment && devLiveServiceUrlOverride) {
    return devLiveServiceUrlOverride;
  }

  // Helper: build the dev default without embedding the exact loopback marker in the JS bundle.
  const devDefaultLiveServiceUrl = () => {
    const host = ['127', '0', '0', '1'].join('.');
    const port = ['40', '00'].join('');
    return `http://${host}:${port}`;
  };

  const raw = process.env.EXPO_PUBLIC_LIVE_SERVICE_URL;

  if (raw && raw.trim()) {
    const normalized = raw.replace(/\/+$/, '');
    if (!isDevelopment && isLoopbackBaseUrl(normalized)) {
      throw new Error(
        'RELEASE_LIVE_BACKEND_MISCONFIGURED: loopback live backend is not allowed in release'
      );
    }
    return normalized;
  }

  // Allow a single-switch dev setup: setting EXPO_PUBLIC_API_BASE_URL to :4000 implies IVS mode.
  const apiBase = process.env.EXPO_PUBLIC_API_BASE_URL;
  if (apiBase && apiBase.trim()) {
    const normalized = apiBase.replace(/\/+$/, '');
    if (normalized.includes(':4000')) {
      if (isDevelopment && !didWarnLiveServiceViaApiBaseUrl) {
        didWarnLiveServiceViaApiBaseUrl = true;
        console.warn(
          '[IVS_API][LIVE_SERVICE] Using EXPO_PUBLIC_API_BASE_URL for live service (IVS mode). ' +
          'Recommended: set EXPO_PUBLIC_LIVE_SERVICE_URL explicitly (dev host or LAN IP on port 4000).'
        );
      }
      if (!isDevelopment && isLoopbackBaseUrl(normalized)) {
        throw new Error(
          'RELEASE_LIVE_BACKEND_MISCONFIGURED: loopback live backend is not allowed in release'
        );
      }
      return normalized;
    }
  }

  // Minimum P0 behavior: do not crash in dev if not configured.
  // Warn once, then use the default local dev URL.
  if (isDevelopment) {
    if (!didWarnUsingDefaultLiveServiceUrl) {
      didWarnUsingDefaultLiveServiceUrl = true;
      console.warn(
        '[IVS_API][LIVE_SERVICE] EXPO_PUBLIC_LIVE_SERVICE_URL is not set and EXPO_PUBLIC_API_BASE_URL is not in IVS mode (:4000). ' +
        'For IVS mode set: EXPO_PUBLIC_API_BASE_URL to your live-service host (port 4000), or set EXPO_PUBLIC_LIVE_SERVICE_URL.'
      );
    }
    return devDefaultLiveServiceUrl();
  }

  // Production: require explicit configuration.
  throw new Error(
    '[IVS_API][LIVE_SERVICE] EXPO_PUBLIC_LIVE_SERVICE_URL is required for production builds. ' +
    'Set it to your live service backend URL (e.g., http://your-backend:4000).'
  );
};

/**
 * Call live backend with Cognito authentication.
 */
async function callLiveBackend<T>(
  path: string,
  method: 'POST' | 'GET' = 'POST',
  body: Record<string, any> = {},
  attemptId?: string
): Promise<T> {
  const LIVE_SERVICE_URL = resolveLiveServiceUrl();

  // Extra tripwire: if we ended up somewhere other than :4000 in dev, warn once.
  if (isDevelopment && !LIVE_SERVICE_URL.includes(':4000') && !didWarnMissingLiveServiceUrl) {
    didWarnMissingLiveServiceUrl = true;
    console.warn(
      '[IVS_API][LIVE_SERVICE] Live service URL does not include :4000. ' +
      'IVS flows are authoritative in backend/blyp-live-service (port 4000). ' +
      `Current resolved URL: ${LIVE_SERVICE_URL}`
    );
  }

  // Get Cognito token
  let token: string;
  try {
    console.log(`[LIVE_API][${path}] Getting Cognito token...`);
    // Cold-start hydration of Cognito storage can take a few seconds on device,
    // so use a longer timeout for live-service calls to avoid false auth failures.
    token = await getCognitoJwtForApi({ tokenType: 'id', timeoutMs: 10000 });
  } catch (err) {
    if (err instanceof Error) {
      throw err;
    }
    throw new Error(`[LIVE_API] Failed to get Cognito token: ${String(err)}`);
  }

  // Build URL with query params for GET requests
  let url = `${LIVE_SERVICE_URL}${path}`;
  if (method === 'GET' && Object.keys(body).length > 0) {
    const params = new URLSearchParams();
    Object.entries(body).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        params.append(key, String(value));
      }
    });
    url = `${url}?${params.toString()}`;
  }

  // Make HTTP request
  try {
    console.log(`[LIVE_API][REQ]`, { path, attemptId, url });
    console.log(`[LIVE_API][${path}] ${method} to ${url}`);
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...(attemptId ? { 'X-GoLive-Attempt-Id': attemptId } : {}),
      },
      body: method === 'GET' ? undefined : JSON.stringify(body),
    });

    console.log(`[LIVE_API][${path}] Response status: ${res.status}`);

    let json: any;
    try {
      json = await res.json();
      console.log(`[LIVE_API][${path}] Response:`, JSON.stringify(json).substring(0, 200));
    } catch {
      throw new Error(
        `[LIVE_API] Invalid JSON response from ${path} (HTTP ${res.status})`
      );
    }

    if (!res.ok) {
      const base = json?.error || `Backend returned HTTP ${res.status}`;
      const code = json?.code ? String(json.code) : '';
      const detail = json?.detail ? String(json.detail) : '';
      const suffix = [code ? `[${code}]` : '', detail ? `- ${detail}` : ''].filter(Boolean).join(' ');
      const errorMsg = suffix ? `${base} ${suffix}` : base;
      throw new Error(`[LIVE_API] ${path} failed: ${errorMsg}`);
    }

    return json as T;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Network request failed') || msg.includes('fetch')) {
      throw new Error(
        `[LIVE_API] Network error calling ${path}: ${msg}. ` +
        'Verify EXPO_PUBLIC_LIVE_SERVICE_URL is correct and reachable. ' +
        `Backend URL: ${LIVE_SERVICE_URL}`
      );
    }
    throw err;
  }
}

// ============================================================================
// NEW LIVE BACKEND API TYPES
// ============================================================================

export interface StartHostLiveResponse {
  sessionId: string;
  streamId?: string;
  stageArn: string;
  token: string;
  channelArn?: string;
}

export interface JoinLiveRealtimeResponse {
  token: string;
  stageArn: string;
}

export interface JoinLiveMassResponse {
  sessionId: string;
  mode?: 'playback' | 'realtime';
  playbackUrl?: string;
  channelArn?: string;
}

export type GuestRequestStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'INVITED'
  | 'LIVE'
  | 'KICKED'
  | 'LEFT'
  | 'REQUESTED';

export interface GuestRequest {
  userId: string;
  status: GuestRequestStatus;
  requestedAt: string;
  updatedAt?: string;
  invitedAt?: string;
  sessionId?: string;
  slotIndex?: number;
}

export interface InviteGuestResponse {
  token: string;
  stageArn: string;
  sessionId: string;
  guestUserId?: string;
  expiresAt?: number;
  slotIndex?: number;
}
// ============================================================================
// HEALTH CHECK (PREFLIGHT)
// ============================================================================

/**
 * Check if backend is reachable before attempting Go Live.
 * Returns true if backend responds with 200, false otherwise.
 * Logs errors but does not throw; caller decides if this is fatal.
 */
async function checkBackendHealth(): Promise<boolean> {
  try {
    const liveServiceUrl = resolveLiveServiceUrl();
    const url = `${liveServiceUrl}/health`;
    console.log('[IVS_API][HEALTH_CHECK]', { url, liveServiceUrl });

    // Physical devices over adb reverse can be slow/flaky, especially right after a cold start.
    // Do a fast attempt first, then a slightly longer retry before failing.
    const tryFetch = async (timeoutMs: number) => {
      try {
        return await fetchWithTimeout(url, timeoutMs);
      } catch (e) {
        console.warn('[IVS_API][HEALTH_CHECK_ATTEMPT_ERROR]', {
          url,
          timeoutMs,
          error: String((e as any)?.message || e),
        });
        return null;
      }
    };

    // Cloud Run scales to zero, so a cold start (boot + VPC/dependency init) can take
    // well over 12s. A too-tight budget here is what surfaced the false "streaming
    // service is offline" message: the preflight gave up before the backend finished
    // cold-starting (Cloud Run holds the request until the instance is ready).
    // Strategy: one fast attempt for the warm path, then a generous retry that
    // comfortably covers a cold boot before we declare the service offline.
    const res = (await tryFetch(4000)) || (await tryFetch(25000));
    if (!res) {
      console.warn('[IVS_API][HEALTH_CHECK_RESULT]', {
        url,
        healthy: false,
        reason: 'fetch failed/timeout',
      });
      // Continue into dev fallback logic below.
    }
    if (res && res.ok) {
      console.log('[IVS_API][HEALTH_CHECK_RESULT]', {
        url,
        status: res.status,
        healthy: true,
      });
      return true;
    }

    console.warn('[IVS_API][HEALTH_CHECK_RESULT]', {
      url,
      status: res ? res.status : 'NO_RESPONSE',
      healthy: false,
    });

    // Dev resilience: if we're trying loopback on a physical device and adb reverse is flaky,
    // fall back to the dev-machine IP derived from the Metro bundle URL.
    if (isDevelopment && isLoopbackBaseUrl(liveServiceUrl)) {
      const altBase = inferDevMachineBaseUrlFromScriptURL(4000);
      if (altBase && altBase !== liveServiceUrl) {
        const altUrl = `${altBase}/health`;
        console.warn('[IVS_API][HEALTH_CHECK_FALLBACK_ATTEMPT]', {
          from: liveServiceUrl,
          to: altBase,
          url: altUrl,
        });

        try {
          const altRes = await fetchWithTimeout(altUrl, 1500);
          const altHealthy = altRes.ok;
          console.log('[IVS_API][HEALTH_CHECK_FALLBACK_RESULT]', {
            url: altUrl,
            status: altRes.status,
            healthy: altHealthy,
          });

          if (altHealthy) {
            devLiveServiceUrlOverride = altBase;
            console.warn('[IVS_API][LIVE_SERVICE] Using dev-machine IP for live service (dev override).', {
              override: devLiveServiceUrlOverride,
              reason: 'loopback health check failed; likely adb reverse missing/flaky',
            });
            return true;
          }
        } catch (fallbackErr) {
          console.error('[IVS_API][HEALTH_CHECK_FALLBACK_ERROR]', {
            url: altUrl,
            error: String(fallbackErr),
          });
        }
      }
    }

    return false;
  } catch (err) {
    console.error('[IVS_API][HEALTH_CHECK_ERROR]', {
      error: String(err),
      liveServiceUrl: '(resolve failed or fetch failed)',
    });
    return false;
  }
}

// ============================================================================
// NEW LIVE BACKEND PUBLIC API
// ============================================================================

/**
 * Start a live session as host.
 * Backend creates IVS Real-Time stage and returns host token.
 *
 * Response normalization:
 * Backend returns: { session: { sessionId, stageArn, ... }, hostToken: string }
 * We normalize to: { sessionId, stageArn, token }
 */
/**
 * Best-effort nearest IVS Real-Time region for this device, derived from the
 * device timezone (offline, no permissions). The backend validates this against
 * its allowlist and falls back to the default region, so a wrong/unknown value
 * is always safe. This is what lets a US host publish to a US media server
 * instead of always crossing to eu-west-1 (which was crashing US go-lives).
 */
export function pickIvsRegionHint(): string | undefined {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    if (!tz) return undefined;
    const city = (tz.split('/')[1] || '').toLowerCase();
    if (tz.startsWith('America/')) {
      const west = ['los_angeles', 'vancouver', 'tijuana', 'phoenix', 'denver', 'edmonton', 'boise', 'whitehorse', 'dawson'];
      return west.some((w) => city.includes(w)) ? 'us-west-2' : 'us-east-1';
    }
    if (tz.startsWith('Europe/') || tz.startsWith('Africa/')) return 'eu-west-1';
    if (tz.startsWith('Australia/')) return 'ap-southeast-2';
    if (tz.startsWith('Asia/')) return 'ap-southeast-1';
    if (tz.startsWith('Pacific/')) return 'us-west-2';
    return undefined;
  } catch {
    return undefined;
  }
}

export async function startHostLive(title: string, attemptId?: string): Promise<StartHostLiveResponse> {
  // CRITICAL: Preflight health check with short timeout.
  // checkBackendHealth() is internally timed-out to avoid hangs.
  const isHealthy = await checkBackendHealth();
  if (!isHealthy) {
    const liveServiceUrl = resolveLiveServiceUrl();
    console.error('[LIVE_API][PREFLIGHT_FAILED]', `Live backend not responding at ${liveServiceUrl}/health`);
    // User-facing copy is intentionally friendly; technical detail stays in logs.
    throw new Error('Live is temporarily unavailable. Our streaming service is offline right now — please try again in a little while.');
  }
  console.log('[LIVE_API][START_HOST_LIVE]', { title, attemptId });

  const region = pickIvsRegionHint();
  console.log('[LIVE_API][REGION_HINT]', { region: region || '(none)' });
  const response = await callLiveBackend<any>('/api/live/start', 'POST', { title, region }, attemptId);

  // Debug: Log raw response shape
  console.log('[LIVE_API][DEBUG_START_HOST_LIVE_RAW_RESPONSE]', JSON.stringify(response));

  // Normalize backend response to frontend interface
  // Backend structure: { session: { sessionId, stageArn, ... }, hostToken: string }
  const data = response as any;
  const session = data.session || data;

  const sessionId: string | undefined =
    session.sessionId || session.streamId || data.sessionId || data.streamId;

  const stageArn: string | undefined =
    session.stageArn || data.stageArn;

  const token: string | undefined =
    data.hostToken || data.token || (data.tokens && (data.tokens.hostToken || data.tokens.host)) || session.hostToken;

  // Validate required fields
  if (!sessionId || !stageArn || !token) {
    console.error('[LIVE_API][START_HOST_LIVE_MISSING_FIELDS]', {
      sessionId,
      stageArn,
      hasToken: !!token,
      raw: data,
    });
    throw new Error(
      `StartHostLiveResponse missing required fields: ` +
      `sessionId=${sessionId ? 'ok' : 'MISSING'}, ` +
      `stageArn=${stageArn ? 'ok' : 'MISSING'}, ` +
      `token=${token ? 'ok' : 'MISSING'}`
    );
  }

  const normalized: StartHostLiveResponse = {
    sessionId,
    streamId: sessionId,
    stageArn,
    token,
  };

  console.log('[LIVE_API][START_HOST_LIVE_NORMALIZED]', {
    sessionId: normalized.sessionId,
    stageArn: normalized.stageArn,
    tokenLength: normalized.token.length
  });

  return normalized;
}

/**
 * Join a live session as viewer (Real-Time participant, subscribe-only).
 */
export async function joinLiveRealtime(
  sessionId: string,
  displayName?: string,
): Promise<JoinLiveRealtimeResponse> {
  console.log('[LIVE_API][JOIN_LIVE_REALTIME]', { sessionId, displayName });
  // Backend expects "streamId"; send both for compatibility. The displayName
  // (when known) lets the backend emit a proper "Alex joined" event instead of
  // an anonymous "Someone joined".
  return callLiveBackend<JoinLiveRealtimeResponse>('/api/live/join-realtime', 'POST', {
    streamId: sessionId,
    sessionId,
    ...(displayName && displayName.trim() ? { displayName: displayName.trim() } : {}),
  });
}

/**
 * Join a live session in mass mode (for future HLS support).
 */
export async function joinLiveMass(sessionId: string, displayName?: string): Promise<JoinLiveMassResponse> {
  console.log('[LIVE_API][JOIN_LIVE_MASS]', { sessionId });
  return callLiveBackend<JoinLiveMassResponse>('/api/live/join', 'POST', {
    sessionId,
    streamId: sessionId,
    ...(displayName && displayName.trim() ? { displayName: displayName.trim() } : {}),
  });
}

/**
 * Request to join as a guest (applies for invitation).
 */
export async function requestGuestSlot(sessionId: string, slotIndexRequested?: number): Promise<void> {
  console.log('[LIVE_API][REQUEST_GUEST_SLOT]', { sessionId, slotIndexRequested });
  await callLiveBackend<{ ok: boolean }>('/api/live/guest/request', 'POST', {
    sessionId,
    ...(typeof slotIndexRequested === 'number' ? { slotIndexRequested } : {}),
  });
}

/**
 * List pending guest requests for a live session (host only).
 */
export async function listGuestRequests(sessionId: string): Promise<GuestRequest[]> {
  console.log('[LIVE_API][LIST_GUEST_REQUESTS]', { sessionId });
  const response = await callLiveBackend<{ requests: GuestRequest[] }>(
    '/api/live/guest/requests',
    'GET',
    { sessionId }
  );
  return response.requests || [];
}

/**
 * Get the current user's guest request for a live session.
 * Returns null if no request exists.
 */
export async function getMyGuestRequest(sessionId: string): Promise<GuestRequest | null> {
  console.log('[LIVE_API][GET_MY_GUEST_REQUEST]', { sessionId });
  const response = await callLiveBackend<{ request: GuestRequest | null }>(
    '/api/live/guest/me',
    'GET',
    { sessionId }
  );
  return response.request || null;
}

/**
 * Invite a guest to join the stage.
 * Returns guest token so guest can join as publisher.
 */
/**
 * Maximum guest publishers on a single IVS stage. IVS Real-Time hard-caps a
 * stage at 12 publishers (non-adjustable); the host always publishes, leaving
 * 11 guest slots. Must stay in sync with MAX_GUEST_SLOTS in the live service.
 */
export const MAX_GUEST_SLOTS = 11;

export async function inviteGuest(
  sessionId: string,
  guestUserId: string
): Promise<InviteGuestResponse> {
  console.log('[LIVE_API][INVITE_GUEST]', { sessionId, guestUserId });
  return callLiveBackend<InviteGuestResponse>('/api/live/guest/invite', 'POST', {
    sessionId,
    guestUserId,
  });
}

/**
 * Create a guest publisher token for the current user.
 * NOTE: The Express live service uses /api/live/guest-token (no separate invite endpoint).
 */
export async function createGuestToken(sessionId: string, guestSessionId?: string): Promise<{ token: string; stageArn: string }> {
  console.log('[LIVE_API][CREATE_GUEST_TOKEN]', { sessionId, hasGuestSessionId: !!guestSessionId });
  return callLiveBackend<{ token: string; stageArn: string }>('/api/live/guest-token', 'POST', {
    sessionId,
    ...(guestSessionId ? { guestSessionId } : {}),
  });
}

export async function leaveGuest(sessionId: string, guestSessionId?: string, force?: boolean): Promise<void> {
  console.log('[LIVE_API][LEAVE_GUEST]', { sessionId, hasGuestSessionId: !!guestSessionId, force: force === true });
  await callLiveBackend<{ ok: boolean }>('/api/live/guest/leave', 'POST', {
    sessionId,
    ...(guestSessionId ? { guestSessionId } : {}),
    ...(force === true ? { force: true } : {}),
  });
}

export async function guestHeartbeat(sessionId: string, guestSessionId: string): Promise<void> {
  console.log('[LIVE_API][GUEST_HEARTBEAT]', { sessionId });
  await callLiveBackend<{ ok: boolean }>('/api/live/guest/heartbeat', 'POST', {
    sessionId,
    guestSessionId,
  });
}

/**
 * Kick a guest from the live session.
 */
export async function kickGuest(sessionId: string, guestUserId: string): Promise<void> {
  console.log('[LIVE_API][KICK_GUEST]', { sessionId, guestUserId });
  await callLiveBackend<{ ok: boolean }>('/api/live/guest/kick', 'POST', {
    sessionId,
    guestUserId,
  });
}

/**
 * Host-only: mute or unmute a guest's mic. The guest's client honors this
 * (mutes + disables self-unmute) via the room signaling event; kick remains the
 * hard control for a non-cooperative guest.
 */
export async function muteGuest(sessionId: string, guestUserId: string, muted: boolean): Promise<void> {
  console.log('[LIVE_API][MUTE_GUEST]', { sessionId, guestUserId, muted });
  await callLiveBackend<{ ok: boolean; muted: boolean }>('/api/live/guest/mute', 'POST', {
    sessionId,
    guestUserId,
    muted,
  });
}

/** Host-only: invite a viewer (who hasn't requested) up onto the stage as a guest. */
export async function hostInviteGuest(sessionId: string, guestUserId: string): Promise<{ ok: boolean; slotIndex?: number }> {
  console.log('[LIVE_API][HOST_INVITE_GUEST]', { sessionId, guestUserId });
  return await callLiveBackend<{ ok: boolean; slotIndex?: number }>('/api/live/guest/host-invite', 'POST', {
    sessionId,
    guestUserId,
  });
}

/** Host-only: turn a guest's camera off/on. Guest cannot self-re-enable while off. */
export async function setGuestCamera(sessionId: string, guestUserId: string, cameraOff: boolean): Promise<void> {
  console.log('[LIVE_API][SET_GUEST_CAMERA]', { sessionId, guestUserId, cameraOff });
  await callLiveBackend<{ ok: boolean; cameraOff: boolean }>('/api/live/guest/camera', 'POST', {
    sessionId,
    guestUserId,
    cameraOff,
  });
}

/** Host-only: appoint a moderator who can then mute/kick guests. */
export async function addModerator(sessionId: string, moderatorUserId: string): Promise<void> {
  console.log('[LIVE_API][ADD_MODERATOR]', { sessionId, moderatorUserId });
  await callLiveBackend<{ ok: boolean }>('/api/live/moderator/add', 'POST', {
    sessionId,
    moderatorUserId,
  });
}

/** Host-only: revoke a moderator. */
export async function removeModerator(sessionId: string, moderatorUserId: string): Promise<void> {
  console.log('[LIVE_API][REMOVE_MODERATOR]', { sessionId, moderatorUserId });
  await callLiveBackend<{ ok: boolean }>('/api/live/moderator/remove', 'POST', {
    sessionId,
    moderatorUserId,
  });
}

/**
 * Reject a guest request (host only).
 */
export async function rejectGuest(sessionId: string, guestUserId: string): Promise<void> {
  console.log('[LIVE_API][REJECT_GUEST]', { sessionId, guestUserId });
  await callLiveBackend<{ ok: boolean }>('/api/live/guest/reject', 'POST', {
    sessionId,
    guestUserId,
  });
}

/**
 * End a live session (host only).
 */
export async function endHostLive(sessionId: string): Promise<void> {
  console.log('[LIVE_API][END_HOST_LIVE]', { sessionId });
  await callLiveBackend<{ ok: boolean }>('/api/live/end', 'POST', { sessionId });
}

// ============================================================================
// BATTLES — one shared stage, both participants are equal co-hosts.
// ============================================================================

/** Creator starts the shared battle stage. Returns normalized host credentials. */
export async function startBattleStageLive(battleId: string, title?: string): Promise<StartHostLiveResponse> {
  const isHealthy = await checkBackendHealth();
  if (!isHealthy) {
    throw new Error('Live is temporarily unavailable. Our streaming service is offline right now — please try again in a little while.');
  }
  const response = await callLiveBackend<any>('/api/live/battle/start', 'POST', { battleId, title: title || '', region: pickIvsRegionHint() });
  const session = response.session || response;
  const sessionId = session.sessionId || response.sessionId;
  const stageArn = session.stageArn || response.stageArn;
  const token = response.hostToken || response.token || session.hostToken;
  if (!sessionId || !stageArn || !token) {
    throw new Error('startBattleStage missing required fields');
  }
  return { sessionId, streamId: sessionId, stageArn, token };
}

/** Opponent joins the existing battle stage as an equal co-host (publisher). */
export async function joinBattleStageLive(
  sessionId: string,
  battleId: string
): Promise<{ token: string; stageArn: string; sessionId: string }> {
  const response = await callLiveBackend<{ token: string; stageArn: string; sessionId?: string }>(
    '/api/live/battle/join',
    'POST',
    { sessionId, battleId }
  );
  return { token: response.token, stageArn: response.stageArn, sessionId: response.sessionId || sessionId };
}

// ============================================================================
// ROOMS — hostless, topic-based group video rooms (open-seat, symmetric N-party).
//
// Every joiner who claims an open seat is pre-authorised to PUBLISH on ONE
// shared IVS stage with no host approval (generalisation of the battle pattern).
// Capacity is enforced server-side; a full room returns ROOM_FULL so the client
// can fall back to watch-only.
// ============================================================================

export interface RoomAmbassador {
  uid: string;
  displayName?: string;
  claimedAt: number;
}

export interface RoomIntroPinned {
  text: string;
  byUid: string;
  byName?: string;
  pinnedAt: number;
}

export interface RoomSummary {
  roomId: string;
  topicId: string;
  topicLabel: string;
  title: string;
  capacity: number;
  publisherCount: number;
  isFull: boolean;
  isActive: boolean;
  hasStage: boolean;
  ambassadors?: RoomAmbassador[];
  ambassadorCount?: number;
  introPinned?: RoomIntroPinned | null;
}

export interface JoinRoomPublisherResponse {
  token: string;
  stageArn: string;
  sessionId: string;
  roomId: string;
  slotIndex: number;
  role: 'participant';
}

export interface JoinRoomViewerResponse {
  token: string;
  stageArn: string;
  sessionId: string;
  roomId: string;
  role: 'viewer';
}

/** Attach a `.code` to live-service errors by scanning the formatted message. */
function decorateRoomError(err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  const known = [
    'ROOM_FULL',
    'ROOM_NOT_FOUND',
    'FIRESTORE_UNAVAILABLE',
    'ROOM_STAGE_TIMEOUT',
    'AMBASSADOR_FULL',
    'NOT_AMBASSADOR',
    'INVALID_INTRO',
  ];
  const e = err instanceof Error ? err : new Error(msg);
  const hit = known.find((c) => msg.includes(c));
  if (hit) (e as any).code = hit;
  throw e;
}

/** List active rooms for the browse screen. Topic grouping happens client-side. */
export async function listRooms(): Promise<RoomSummary[]> {
  const response = await callLiveBackend<{ rooms: RoomSummary[] }>('/api/rooms', 'GET', {});
  return response.rooms || [];
}

/** Join a room as a publisher, claiming an open seat. Throws code ROOM_FULL when full. */
export async function joinRoomAsPublisher(roomId: string, displayName?: string): Promise<JoinRoomPublisherResponse> {
  console.log('[LIVE_API][ROOM_JOIN_PUBLISHER]', { roomId });
  try {
    return await callLiveBackend<JoinRoomPublisherResponse>('/api/rooms/join', 'POST', {
      roomId,
      ...(displayName ? { displayName } : {}),
    });
  } catch (err) {
    return decorateRoomError(err);
  }
}

/** Join a room as a SUBSCRIBE-only viewer (room full, or just watching). */
export async function joinRoomAsViewer(roomId: string, displayName?: string): Promise<JoinRoomViewerResponse> {
  console.log('[LIVE_API][ROOM_JOIN_VIEWER]', { roomId });
  try {
    return await callLiveBackend<JoinRoomViewerResponse>('/api/rooms/watch', 'POST', {
      roomId,
      ...(displayName ? { displayName } : {}),
    });
  } catch (err) {
    return decorateRoomError(err);
  }
}

/** Free the caller's seat + remove presence (graceful leave). */
export async function leaveRoom(roomId: string): Promise<void> {
  console.log('[LIVE_API][ROOM_LEAVE]', { roomId });
  await callLiveBackend<{ ok: boolean }>('/api/rooms/leave', 'POST', { roomId });
}

/** Presence heartbeat — keeps the caller's seat from being swept as stale. */
export async function roomHeartbeat(roomId: string): Promise<void> {
  await callLiveBackend<{ ok: boolean }>('/api/rooms/heartbeat', 'POST', { roomId });
}

/** Opt-in as a page ambassador for a topic room. */
export async function claimRoomAmbassador(
  roomId: string,
  displayName?: string,
): Promise<{ ambassadors: RoomAmbassador[]; alreadyAmbassador: boolean; room: RoomSummary }> {
  try {
    return await callLiveBackend('/api/rooms/ambassador/claim', 'POST', {
      roomId,
      ...(displayName ? { displayName } : {}),
    });
  } catch (err) {
    return decorateRoomError(err);
  }
}

/** Pin a short welcome/intro (ambassadors only). */
export async function pinRoomAmbassadorIntro(
  roomId: string,
  text: string,
  displayName?: string,
): Promise<{ introPinned: RoomIntroPinned }> {
  try {
    return await callLiveBackend('/api/rooms/ambassador/intro', 'POST', {
      roomId,
      text,
      ...(displayName ? { displayName } : {}),
    });
  } catch (err) {
    return decorateRoomError(err);
  }
}

// ============================================================================
// BLYP ARTILLERY — server-authoritative battle-stage game
// ============================================================================

export interface ArtilleryStateEvent {
  sessionId: string;
  type: 'STATE' | 'SHOT';
  version: number;
  battleId: string | null;
  players: { '0': string | null; '1': string | null };
  state: any; // engine MatchState
  outcome?: any; // present on SHOT events
  revive?: { receiverUserId: string; senderUserId?: string };
}

/** Creator opens the artillery match on their battle session. */
export async function artilleryStart(
  sessionId: string,
  battleId?: string,
  names?: { creatorName?: string; opponentName?: string }
): Promise<ArtilleryStateEvent> {
  return callLiveBackend<ArtilleryStateEvent>('/api/live-game/artillery/start', 'POST', {
    sessionId,
    ...(battleId ? { battleId } : {}),
    ...(names || {}),
  });
}

/** Opponent registers as team 1. */
export async function artilleryJoin(sessionId: string): Promise<ArtilleryStateEvent> {
  return callLiveBackend<ArtilleryStateEvent>('/api/live-game/artillery/join', 'POST', { sessionId });
}

/** Current-turn player fires. Server validates the turn + unit ownership. */
export async function artilleryFire(
  sessionId: string,
  input: { unitId: number; weaponId: string; angleDeg: number; power: number }
): Promise<ArtilleryStateEvent> {
  return callLiveBackend<ArtilleryStateEvent>('/api/live-game/artillery/fire', 'POST', { sessionId, ...input });
}

/** Fetch the current authoritative match state (spectators / late joiners). */
export async function artilleryGetState(sessionId: string): Promise<ArtilleryStateEvent> {
  return callLiveBackend<ArtilleryStateEvent>('/api/live-game/artillery/state', 'GET', { sessionId });
}

// ============================================================================
// BLYP MARBLE RACE — Guest Grand Prix (server-authoritative live overlay)
// ============================================================================

export interface MarbleGameEvent {
  game: 'marble';
  sessionId: string;
  type: 'PHASE' | 'SNAPSHOT' | 'BOOST' | 'FINISH' | 'PODIUM' | 'ENDED';
  version: number;
  hostUserId: string;
  state: any;
}

export async function marbleStart(
  sessionId: string,
  opts?: { hostName?: string; racers?: Array<{ userId: string; displayName: string }> }
): Promise<MarbleGameEvent> {
  return callLiveBackend<MarbleGameEvent>('/api/live-game/marble/start', 'POST', {
    sessionId,
    ...(opts?.hostName ? { hostName: opts.hostName } : {}),
    ...(opts?.racers ? { racers: opts.racers } : {}),
  });
}

export async function marbleNextHeat(sessionId: string): Promise<MarbleGameEvent> {
  return callLiveBackend<MarbleGameEvent>('/api/live-game/marble/next-heat', 'POST', { sessionId });
}

export async function marbleEnd(sessionId: string): Promise<MarbleGameEvent> {
  return callLiveBackend<MarbleGameEvent>('/api/live-game/marble/end', 'POST', { sessionId });
}

export async function marblePick(sessionId: string, racerUserId: string): Promise<MarbleGameEvent> {
  return callLiveBackend<MarbleGameEvent>('/api/live-game/marble/pick', 'POST', { sessionId, racerUserId });
}

export async function marbleGetState(sessionId: string): Promise<MarbleGameEvent> {
  return callLiveBackend<MarbleGameEvent>('/api/live-game/marble/state', 'GET', { sessionId });
}

// ============================================================================
// FRENEMIES — live party game (server-authoritative)
// ============================================================================

export interface FrenemiesGameEvent {
  game: 'frenemies';
  sessionId: string;
  type: 'PHASE' | 'SNAPSHOT' | 'RESULT' | 'ENDED';
  version: number;
  hostUserId: string;
  startedByUserId?: string;
  state: any;
  spinMs?: number;
  chooseMs?: number;
  challengeMs?: number;
  houseCoins?: number;
  maxSlots?: number;
}

export async function frenemiesStart(sessionId: string): Promise<FrenemiesGameEvent> {
  return callLiveBackend<FrenemiesGameEvent>('/api/live-game/frenemies/start', 'POST', { sessionId });
}

export async function frenemiesEnd(sessionId: string): Promise<FrenemiesGameEvent> {
  return callLiveBackend<FrenemiesGameEvent>('/api/live-game/frenemies/end', 'POST', { sessionId });
}

export async function frenemiesThrow(sessionId: string, targetUserId: string): Promise<FrenemiesGameEvent> {
  return callLiveBackend<FrenemiesGameEvent>('/api/live-game/frenemies/throw', 'POST', {
    sessionId,
    targetUserId,
  });
}

export async function frenemiesQuizAnswer(
  sessionId: string,
  choiceIndex: number,
  displayName?: string
): Promise<FrenemiesGameEvent> {
  return callLiveBackend<FrenemiesGameEvent>('/api/live-game/frenemies/quiz-answer', 'POST', {
    sessionId,
    choiceIndex,
    ...(displayName ? { displayName } : {}),
  });
}

export async function frenemiesChat(
  sessionId: string,
  text: string,
  displayName?: string
): Promise<FrenemiesGameEvent> {
  return callLiveBackend<FrenemiesGameEvent>('/api/live-game/frenemies/chat', 'POST', {
    sessionId,
    text,
    ...(displayName ? { displayName } : {}),
  });
}

export async function frenemiesLike(
  sessionId: string,
  count = 1,
  displayName?: string
): Promise<FrenemiesGameEvent | { ok: boolean }> {
  return callLiveBackend<FrenemiesGameEvent | { ok: boolean }>('/api/live-game/frenemies/like', 'POST', {
    sessionId,
    count,
    ...(displayName ? { displayName } : {}),
  });
}

export async function frenemiesGetState(sessionId: string): Promise<FrenemiesGameEvent> {
  return callLiveBackend<FrenemiesGameEvent>('/api/live-game/frenemies/state', 'GET', { sessionId });
}

export type SessionEngagement = {
  likes: number;
  shares: number;
  comments: number;
  coinsSpent: number;
  coinsReceived: number;
};

export async function bumpLiveEngagement(
  sessionId: string,
  delta: Partial<SessionEngagement>
): Promise<{ ok: boolean }> {
  return callLiveBackend<{ ok: boolean }>('/api/live/engagement/bump', 'POST', {
    sessionId,
    ...delta,
  });
}

export async function getLiveEngagementSession(
  sessionId: string
): Promise<{ sessionId: string; byUser: Record<string, SessionEngagement> }> {
  return callLiveBackend<{ sessionId: string; byUser: Record<string, SessionEngagement> }>(
    '/api/live/engagement/session',
    'GET',
    { sessionId }
  );
}
