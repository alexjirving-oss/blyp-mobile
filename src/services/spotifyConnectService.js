/**
 * Spotify Connect (Model A) — user's own Premium account, background listen in Blyp.
 * Not a catalog reseller. Requires EXPO_PUBLIC_SPOTIFY_CLIENT_ID + Dashboard redirect.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

WebBrowser.maybeCompleteAuthSession();

const TOKEN_KEY = 'blyp.spotify.tokens.v1';
const SCOPES = [
  'user-read-email',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'streaming',
].join(' ');

const discovery = {
  authorizationEndpoint: 'https://accounts.spotify.com/authorize',
  tokenEndpoint: 'https://accounts.spotify.com/api/token',
};

const readEnv = (name) => {
  try {
    return process.env?.[name];
  } catch {
    return undefined;
  }
};

export const getSpotifyClientId = () =>
  String(readEnv('EXPO_PUBLIC_SPOTIFY_CLIENT_ID') || '').trim();

export const getSpotifyRedirectUri = () => {
  const fromEnv = String(readEnv('EXPO_PUBLIC_SPOTIFY_REDIRECT_URI') || '').trim();
  if (fromEnv) return fromEnv;
  return AuthSession.makeRedirectUri({ scheme: 'blyp', path: 'spotify' });
};

export const isSpotifyConnectConfigured = () => getSpotifyClientId().length > 0;

async function readTokens() {
  try {
    const raw = await AsyncStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeTokens(tokens) {
  if (!tokens) {
    await AsyncStorage.removeItem(TOKEN_KEY);
    return;
  }
  await AsyncStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
}

export async function getSpotifyLinkStatus() {
  const tokens = await readTokens();
  if (!tokens?.accessToken) {
    return { linked: false, displayName: null, configured: isSpotifyConnectConfigured() };
  }
  const profile = await spotifyFetch('/me', { tokens }).catch(() => null);
  return {
    linked: true,
    displayName: profile?.display_name || profile?.id || 'Spotify',
    configured: isSpotifyConnectConfigured(),
    product: profile?.product || null,
  };
}

async function refreshIfNeeded(tokens) {
  if (!tokens?.refreshToken) return tokens;
  const expiresAt = Number(tokens.expiresAt || 0);
  if (expiresAt && Date.now() < expiresAt - 60_000) return tokens;

  const clientId = getSpotifyClientId();
  if (!clientId) return tokens;

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokens.refreshToken,
    client_id: clientId,
  });
  const res = await fetch(discovery.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    await writeTokens(null);
    throw new Error('Spotify session expired. Link again.');
  }
  const json = await res.json();
  const next = {
    accessToken: json.access_token,
    refreshToken: json.refresh_token || tokens.refreshToken,
    expiresAt: Date.now() + Number(json.expires_in || 3600) * 1000,
    tokenType: json.token_type || 'Bearer',
  };
  await writeTokens(next);
  return next;
}

async function spotifyFetch(path, { method = 'GET', body, tokens: incoming } = {}) {
  let tokens = incoming || (await readTokens());
  if (!tokens?.accessToken) throw new Error('Spotify is not linked.');
  tokens = await refreshIfNeeded(tokens);

  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${tokens.accessToken}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const msg = json?.error?.message || json?.error_description || `Spotify API ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

export async function linkSpotifyAccount() {
  const clientId = getSpotifyClientId();
  if (!clientId) {
    throw new Error(
      'Spotify Client ID missing. Add EXPO_PUBLIC_SPOTIFY_CLIENT_ID and rebuild. See docs/SPOTIFY_CONNECT.md.',
    );
  }
  const redirectUri = getSpotifyRedirectUri();
  const request = new AuthSession.AuthRequest({
    clientId,
    scopes: SCOPES.split(' '),
    redirectUri,
    usePKCE: true,
    responseType: AuthSession.ResponseType.Code,
  });
  await request.makeAuthUrlAsync(discovery);
  const result = await request.promptAsync(discovery);
  if (result.type !== 'success' || !result.params?.code) {
    if (result.type === 'dismiss' || result.type === 'cancel') {
      throw new Error('Spotify link cancelled.');
    }
    throw new Error('Spotify link failed.');
  }

  const tokenRes = await AuthSession.exchangeCodeAsync(
    {
      clientId,
      code: result.params.code,
      redirectUri,
      extraParams: request.codeVerifier ? { code_verifier: request.codeVerifier } : undefined,
    },
    discovery,
  );

  const tokens = {
    accessToken: tokenRes.accessToken,
    refreshToken: tokenRes.refreshToken,
    expiresAt: Date.now() + Number(tokenRes.expiresIn || 3600) * 1000,
    tokenType: tokenRes.tokenType || 'Bearer',
  };
  await writeTokens(tokens);
  return getSpotifyLinkStatus();
}

export async function unlinkSpotifyAccount() {
  await writeTokens(null);
}

export async function getSpotifyPlaybackState() {
  return spotifyFetch('/me/player');
}

export async function pauseSpotifyPlayback() {
  try {
    await spotifyFetch('/me/player/pause', { method: 'PUT' });
    return true;
  } catch (e) {
    // 403/404 when nothing is active — treat as already paused.
    if (/NO_ACTIVE_DEVICE|Not Found|Restriction violated/i.test(String(e?.message || e))) {
      return false;
    }
    throw e;
  }
}

export async function resumeSpotifyPlayback() {
  try {
    await spotifyFetch('/me/player/play', { method: 'PUT' });
    return true;
  } catch (e) {
    if (/NO_ACTIVE_DEVICE/i.test(String(e?.message || e))) {
      throw new Error(
        'No active Spotify device. Open Spotify on this phone (or another device), start playback once, then return to Blyp.',
      );
    }
    throw e;
  }
}

export async function transferSpotifyPlaybackToThisDevice(deviceId, { play = true } = {}) {
  if (!deviceId) throw new Error('Missing Spotify device id.');
  await spotifyFetch('/me/player', {
    method: 'PUT',
    body: { device_ids: [deviceId], play: !!play },
  });
}

export function spotifyConnectSetupHint() {
  const redirect = getSpotifyRedirectUri();
  return (
    `Create a Spotify Developer app, enable Spotify PKCE, add redirect URI:\n${redirect}\n` +
    `Put the Client ID in EXPO_PUBLIC_SPOTIFY_CLIENT_ID (EAS + local), then rebuild. Package: ${
      Platform.OS === 'android' ? 'com.blyp.mobile' : 'iOS bundle'
    }. Full steps: docs/SPOTIFY_CONNECT.md`
  );
}

export default {
  isSpotifyConnectConfigured,
  getSpotifyClientId,
  getSpotifyRedirectUri,
  getSpotifyLinkStatus,
  linkSpotifyAccount,
  unlinkSpotifyAccount,
  getSpotifyPlaybackState,
  pauseSpotifyPlayback,
  resumeSpotifyPlayback,
  transferSpotifyPlaybackToThisDevice,
  spotifyConnectSetupHint,
};
