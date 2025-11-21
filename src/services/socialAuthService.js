// Social authentication service (Google & Facebook) for Blyp Mobile
// Plain JS module (no React) using expo-auth-session. All functions are side-effect free
// except performing the OAuth flow and fetching basic profile data.
//
// Env gating: Returns disabled unless EXPO_PUBLIC_ENABLE_SOCIAL_AUTH === 'true' and
// required provider env vars exist.
//
// Required env vars (when enabled):
//   EXPO_PUBLIC_ENABLE_SOCIAL_AUTH=true
//   EXPO_PUBLIC_GOOGLE_CLIENT_ID=<client-id>
//   (optional) EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=<web-client-id>
//   EXPO_PUBLIC_FACEBOOK_APP_ID=<fb-app-id>
//
// NOTE: This implementation uses the implicit flow (response_type=token) for simplicity.
// For production-grade token exchange with backend/Cognito federation, migrate to the
// authorization code flow with PKCE and perform secure token exchange server-side.

import * as AuthSession from 'expo-auth-session';

// Safe lower-case string read helper
const readEnv = (name) => {
  try { return process.env?.[name]; } catch { return undefined; }
};

export const isSocialAuthEnabled = () => {
  try {
    const flag = String(readEnv('EXPO_PUBLIC_ENABLE_SOCIAL_AUTH') || '').toLowerCase();
    if (!['true','1','yes','on'].includes(flag)) return false;
    const googleId = readEnv('EXPO_PUBLIC_GOOGLE_CLIENT_ID');
    const fbId = readEnv('EXPO_PUBLIC_FACEBOOK_APP_ID');
    if (!googleId || !fbId) return false;
    return true;
  } catch { return false; }
};

// Common util to build redirect URI respecting Expo environment.
const buildRedirectUri = () => {
  try {
    return AuthSession.makeRedirectUri({
      // native and proxy defaults; leave scheme to Expo config
      preferLocalhost: true,
    });
  } catch { return ''; }
};

// Normalize profile object
const normalizeUser = ({ provider, providerUserId, email, name, avatarUrl, idToken, accessToken }) => ({
  provider,
  providerUserId,
  email,
  name,
  avatarUrl,
  idToken,
  accessToken,
});

// --- GOOGLE ---
export const signInWithGoogle = async () => {
  const enabled = isSocialAuthEnabled();
  if (!enabled) throw new Error('Social auth not enabled');
  const clientId = readEnv('EXPO_PUBLIC_GOOGLE_CLIENT_ID');
  if (!clientId) throw new Error('Google sign-in cancelled or not configured');
  const redirectUri = buildRedirectUri();
  // implicit flow for now (response_type=token)
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token%20id_token&scope=${encodeURIComponent('openid profile email')}&include_granted_scopes=true`; 
  const result = await AuthSession.startAsync({ authUrl });
  if (result.type !== 'success' || !result.params) {
    throw new Error('Google sign-in cancelled or not configured');
  }
  const { access_token: accessToken, id_token: idToken } = result.params;
  if (!accessToken) throw new Error('Google sign-in cancelled or not configured');
  let profile = {};
  try {
    const resp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (resp.ok) profile = await resp.json();
  } catch (e) {
    console.warn('[SOCIAL][GOOGLE] profile fetch failed', e?.message || e);
  }
  const user = normalizeUser({
    provider: 'google',
    providerUserId: profile.sub || '',
    email: profile.email,
    name: profile.name,
    avatarUrl: profile.picture,
    idToken,
    accessToken,
  });
  console.log('[SOCIAL][GOOGLE] success', {
    providerUserId: user.providerUserId,
    email: user.email,
    name: user.name,
  });
  return user;
};

// --- FACEBOOK ---
export const signInWithFacebook = async () => {
  const enabled = isSocialAuthEnabled();
  if (!enabled) throw new Error('Social auth not enabled');
  const appId = readEnv('EXPO_PUBLIC_FACEBOOK_APP_ID');
  if (!appId) throw new Error('Facebook sign-in cancelled or not configured');
  const redirectUri = buildRedirectUri();
  // implicit flow
  const authUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${encodeURIComponent(appId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token&scope=${encodeURIComponent('public_profile,email')}`;
  const result = await AuthSession.startAsync({ authUrl });
  if (result.type !== 'success' || !result.params) {
    throw new Error('Facebook sign-in cancelled or not configured');
  }
  const { access_token: accessToken } = result.params;
  if (!accessToken) throw new Error('Facebook sign-in cancelled or not configured');
  let profile = {};
  try {
    const resp = await fetch(`https://graph.facebook.com/me?fields=id,name,email,picture.type(large)&access_token=${encodeURIComponent(accessToken)}`);
    if (resp.ok) profile = await resp.json();
  } catch (e) {
    console.warn('[SOCIAL][FACEBOOK] profile fetch failed', e?.message || e);
  }
  const user = normalizeUser({
    provider: 'facebook',
    providerUserId: profile.id || '',
    email: profile.email,
    name: profile.name,
    avatarUrl: profile?.picture?.data?.url,
    idToken: undefined,
    accessToken,
  });
  console.log('[SOCIAL][FACEBOOK] success', {
    providerUserId: user.providerUserId,
    email: user.email,
    name: user.name,
  });
  return user;
};

export default {
  isSocialAuthEnabled,
  signInWithGoogle,
  signInWithFacebook,
};
