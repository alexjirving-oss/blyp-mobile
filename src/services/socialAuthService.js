// Social authentication service (Google & Facebook) for Blyp Mobile.
// Uses expo-auth-session AuthRequest + promptAsync (startAsync was removed in SDK 49+).
//
// Env gating: disabled unless EXPO_PUBLIC_ENABLE_SOCIAL_AUTH === 'true' and
// required provider env vars exist.
//
// Cognito federation still requires Hosted UI / IdP linking in the user pool.
// Callers must NOT treat a successful OAuth profile as a Cognito session.

import * as AuthSession from 'expo-auth-session';
import { AuthRequest, ResponseType } from 'expo-auth-session';

try {
  // Optional peer used by AuthSession to close the popup on web.
  // eslint-disable-next-line global-require
  require('expo-web-browser').maybeCompleteAuthSession?.();
} catch {
  // ignore
}

const readEnv = (name) => {
  try {
    return process.env?.[name];
  } catch {
    return undefined;
  }
};

export const isSocialAuthEnabled = () => {
  try {
    const flag = String(readEnv('EXPO_PUBLIC_ENABLE_SOCIAL_AUTH') || '').toLowerCase();
    if (!['true', '1', 'yes', 'on'].includes(flag)) return false;
    const googleId = readEnv('EXPO_PUBLIC_GOOGLE_CLIENT_ID');
    const fbId = readEnv('EXPO_PUBLIC_FACEBOOK_APP_ID');
    if (!googleId || !fbId) return false;
    return true;
  } catch {
    return false;
  }
};

/** True when Cognito Hosted UI domain is configured for IdP federation. */
export const isCognitoFederationConfigured = () => {
  const domain = String(readEnv('EXPO_PUBLIC_COGNITO_DOMAIN') || '').trim();
  return domain.length > 0;
};

const buildRedirectUri = () => {
  try {
    return AuthSession.makeRedirectUri({ preferLocalhost: true });
  } catch {
    return '';
  }
};

const normalizeUser = ({ provider, providerUserId, email, name, avatarUrl, idToken, accessToken }) => ({
  provider,
  providerUserId,
  email,
  name,
  avatarUrl,
  idToken,
  accessToken,
});

export const signInWithGoogle = async () => {
  if (!isSocialAuthEnabled()) throw new Error('Social auth not enabled');
  const clientId = readEnv('EXPO_PUBLIC_GOOGLE_CLIENT_ID');
  if (!clientId) throw new Error('Google sign-in is not configured');

  const redirectUri = buildRedirectUri();
  const request = new AuthRequest({
    clientId,
    redirectUri,
    scopes: ['openid', 'profile', 'email'],
    responseType: ResponseType.Token,
    usePKCE: false,
    extraParams: {
      include_granted_scopes: 'true',
    },
  });

  const result = await request.promptAsync({
    authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  });

  if (result.type !== 'success' || !result.params) {
    throw new Error('Google sign-in cancelled');
  }

  const accessToken = String(result.params.access_token || '').trim();
  const idToken = String(result.params.id_token || '').trim() || undefined;
  if (!accessToken) throw new Error('Google sign-in did not return an access token');

  let profile = {};
  try {
    const resp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (resp.ok) profile = await resp.json();
  } catch (e) {
    console.warn('[SOCIAL][GOOGLE] profile fetch failed', e?.message || e);
  }

  return normalizeUser({
    provider: 'google',
    providerUserId: profile.sub || '',
    email: profile.email,
    name: profile.name,
    avatarUrl: profile.picture,
    idToken,
    accessToken,
  });
};

export const signInWithFacebook = async () => {
  if (!isSocialAuthEnabled()) throw new Error('Social auth not enabled');
  const appId = readEnv('EXPO_PUBLIC_FACEBOOK_APP_ID');
  if (!appId) throw new Error('Facebook sign-in is not configured');

  const redirectUri = buildRedirectUri();
  const request = new AuthRequest({
    clientId: appId,
    redirectUri,
    scopes: ['public_profile', 'email'],
    responseType: ResponseType.Token,
    usePKCE: false,
  });

  const result = await request.promptAsync({
    authorizationEndpoint: 'https://www.facebook.com/v19.0/dialog/oauth',
  });

  if (result.type !== 'success' || !result.params) {
    throw new Error('Facebook sign-in cancelled');
  }

  const accessToken = String(result.params.access_token || '').trim();
  if (!accessToken) throw new Error('Facebook sign-in did not return an access token');

  let profile = {};
  try {
    const resp = await fetch(
      `https://graph.facebook.com/me?fields=id,name,email,picture.type(large)&access_token=${encodeURIComponent(accessToken)}`
    );
    if (resp.ok) profile = await resp.json();
  } catch (e) {
    console.warn('[SOCIAL][FACEBOOK] profile fetch failed', e?.message || e);
  }

  return normalizeUser({
    provider: 'facebook',
    providerUserId: profile.id || '',
    email: profile.email,
    name: profile.name,
    avatarUrl: profile?.picture?.data?.url,
    idToken: undefined,
    accessToken,
  });
};

export default {
  isSocialAuthEnabled,
  isCognitoFederationConfigured,
  signInWithGoogle,
  signInWithFacebook,
};
