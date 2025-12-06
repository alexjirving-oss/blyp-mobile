/**
 * IVS Live API Client
 * 
 * Calls backend endpoints to get IVS participant tokens for host/guest/viewer roles.
 * Backend must provide tokens with appropriate permissions and expiration times.
 * 
 * Endpoints:
 * - POST /ivs/host/start - Create stage and get host token
 * - POST /ivs/guest/join - Get guest publisher token
 * - POST /ivs/viewer/join - Get viewer subscriber token
 */

import { getCognitoIdToken } from '../hooks/useCommon';

// API base URL from environment; required for IVS backend integration
const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

if (!API_BASE_URL && process.env.NODE_ENV === 'production') {
  console.warn(
    '[IVS_API] EXPO_PUBLIC_API_BASE_URL not configured. ' +
    'Set in .env or environment for production deployments.'
  );
}

export type IVSJoinRole = 'host' | 'guest' | 'viewer';

export interface IVSJoinResponse {
  streamId: string;
  stageArn: string;
  region: string;
  role: IVSJoinRole;
  participantToken: string;
  expiresAt: string;
  userId: string;
}

interface IVSHostStartParams {
  title?: string;
  streamId?: string;
}

interface IVSGuestJoinParams {
  streamId: string;
}

interface IVSViewerJoinParams {
  streamId: string;
}

async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  if (!API_BASE_URL) {
    throw new Error(
      '[IVS_API] Backend API base URL not configured. ' +
      'Set EXPO_PUBLIC_API_BASE_URL environment variable.'
    );
  }

  const token = await getCognitoIdToken();
  
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  return response;
}

/**
 * Start streaming as host
 * Calls backend to create IVS stage and get participant token
 */
export async function ivsHostStart(params: IVSHostStartParams): Promise<IVSJoinResponse> {
  console.log('[IVS_API][HOST_START_REQUEST]', params);
  
  try {
    const response = await fetchWithAuth(`${API_BASE_URL}/ivs/host/start`, {
      method: 'POST',
      body: JSON.stringify(params),
    });

    const data = await response.json();
    console.log('[IVS_API][HOST_START_SUCCESS]', { streamId: data.streamId });
    return data;
  } catch (error) {
    console.error('[IVS_API][HOST_START_ERROR]', error);
    throw error;
  }
}

/**
 * Join stream as guest (co-host)
 * Gets participant token with PUBLISHER role
 */
export async function ivsGuestJoin(params: IVSGuestJoinParams): Promise<IVSJoinResponse> {
  console.log('[IVS_API][GUEST_JOIN_REQUEST]', params);
  
  try {
    const response = await fetchWithAuth(`${API_BASE_URL}/ivs/guest/join`, {
      method: 'POST',
      body: JSON.stringify(params),
    });

    const data = await response.json();
    console.log('[IVS_API][GUEST_JOIN_SUCCESS]', { streamId: data.streamId });
    return data;
  } catch (error) {
    console.error('[IVS_API][GUEST_JOIN_ERROR]', error);
    throw error;
  }
}

/**
 * Join stream as viewer
 * Gets participant token with SUBSCRIBER role
 */
export async function ivsViewerJoin(params: IVSViewerJoinParams): Promise<IVSJoinResponse> {
  console.log('[IVS_API][VIEWER_JOIN_REQUEST]', params);
  
  try {
    const response = await fetchWithAuth(`${API_BASE_URL}/ivs/viewer/join`, {
      method: 'POST',
      body: JSON.stringify(params),
    });

    const data = await response.json();
    console.log('[IVS_API][VIEWER_JOIN_SUCCESS]', { streamId: data.streamId });
    return data;
  } catch (error) {
    console.error('[IVS_API][VIEWER_JOIN_ERROR]', error);
    throw error;
  }
}
