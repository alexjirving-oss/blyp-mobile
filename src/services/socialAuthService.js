// Cognito Hosted UI federation. Provider tokens stay behind Cognito; the app
// receives the same user-pool session used by password sign-in.
import { Platform } from 'react-native';
import { fetchAuthSession, getCurrentUser, signInWithRedirect } from 'aws-amplify/auth';
import { CognitoUser } from 'amazon-cognito-identity-js';
import awsconfig from '../aws-exports';
import { hydrateCognitoStorageCache, flushCognitoStorageWrites } from '../lib/auth/cognitoStorage';
import { userPool } from '../hooks/useCommon';

const DEFAULT_UI_PROVIDERS = ['Google', 'Facebook', 'TikTok'];
const DEFAULT_READY_PROVIDERS = ['Google', 'Facebook', 'TikTok'];

const readEnv = (name) => {
  try {
    return process.env?.[name];
  } catch {
    return undefined;
  }
};

const truthy = (value) =>
  ['true', '1', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());

const falsy = (value) =>
  ['false', '0', 'no', 'off'].includes(String(value ?? '').trim().toLowerCase());

/** Hosted UI domain from env or generated aws-exports oauth block. */
export const getCognitoHostedUiDomain = () => {
  const fromEnv = String(readEnv('EXPO_PUBLIC_COGNITO_DOMAIN') || '')
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
  if (fromEnv) return fromEnv;
  try {
    const fromExports = String(awsconfig?.oauth?.domain || '')
      .trim()
      .replace(/^https?:\/\//, '')
      .replace(/\/+$/, '');
    return fromExports;
  } catch {
    return '';
  }
};

/** True when Cognito Hosted UI domain is configured for IdP federation. */
export const isCognitoFederationConfigured = () => getCognitoHostedUiDomain().length > 0;

const parseProviderList = (raw, fallback) => {
  const source = String(raw ?? '').trim();
  if (!source) return [...fallback];
  if (falsy(source) || source.toLowerCase() === 'none') return [];
  return source
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

const configuredReadyProviders = () => {
  const list = parseProviderList(
    readEnv('EXPO_PUBLIC_SOCIAL_PROVIDERS'),
    DEFAULT_READY_PROVIDERS,
  );
  return new Set(list.map((item) => item.toLowerCase()));
};

const configuredUiProviders = () => {
  // UI list can be narrowed via EXPO_PUBLIC_SOCIAL_UI_PROVIDERS; otherwise show
  // the product set (Google/Facebook/TikTok + Apple on iOS).
  const explicit = readEnv('EXPO_PUBLIC_SOCIAL_UI_PROVIDERS');
  if (explicit != null && String(explicit).trim() !== '') {
    return parseProviderList(explicit, DEFAULT_UI_PROVIDERS);
  }
  const list = [...DEFAULT_UI_PROVIDERS];
  if (Platform.OS === 'ios') list.push('Apple');
  return list;
};

/**
 * Master kill-switch for social UI. Default ON so login always offers providers.
 * Set EXPO_PUBLIC_ENABLE_SOCIAL_AUTH=false to hide the row entirely.
 */
export const isSocialAuthUiEnabled = () => {
  try {
    const flag = readEnv('EXPO_PUBLIC_ENABLE_SOCIAL_AUTH');
    if (flag == null || String(flag).trim() === '') return true;
    return !falsy(flag);
  } catch {
    return true;
  }
};

/** Back-compat: "enabled" means federation can actually run for this build. */
export const isSocialAuthEnabled = () => {
  try {
    if (!isSocialAuthUiEnabled()) return false;
    return isCognitoFederationConfigured();
  } catch {
    return false;
  }
};

export const listSocialProvidersForUi = () => {
  if (!isSocialAuthUiEnabled()) return [];
  return configuredUiProviders().filter((provider) => {
    if (provider.toLowerCase() === 'apple' && Platform.OS !== 'ios') return false;
    return true;
  });
};

export const isSocialProviderVisible = (provider) =>
  listSocialProvidersForUi()
    .map((item) => item.toLowerCase())
    .includes(String(provider || '').toLowerCase());

/** Provider is wired for Hosted UI in this build (domain + allow-list). */
export const isSocialProviderEnabled = (provider) => {
  if (!isSocialAuthEnabled()) return false;
  return configuredReadyProviders().has(String(provider || '').toLowerCase());
};

export const getSocialProviderSetupMessage = (provider) => {
  const name = String(provider || 'Social');
  if (!isCognitoFederationConfigured()) {
    return (
      `${name} sign-in needs Cognito Hosted UI. Set EXPO_PUBLIC_COGNITO_DOMAIN ` +
      `(and EXPO_PUBLIC_ENABLE_AMPLIFY=true) then configure the ${name} identity ` +
      `provider in Cognito Console. See _agent/auth/SOCIAL_SIGNIN.md.`
    );
  }
  if (!configuredReadyProviders().has(name.toLowerCase())) {
    return (
      `${name} is not listed in EXPO_PUBLIC_SOCIAL_PROVIDERS for this build. ` +
      `Add it after the Cognito provider is configured. See _agent/auth/SOCIAL_SIGNIN.md.`
    );
  }
  return (
    `${name} sign-in is not ready yet. Finish Cognito / IdP Console setup ` +
    `(see _agent/auth/SOCIAL_SIGNIN.md) and rebuild with the Hosted UI domain set.`
  );
};

const signInWithProvider = async (provider, redirectProvider = provider) => {
  if (!isSocialProviderEnabled(provider)) {
    throw new Error(getSocialProviderSetupMessage(provider));
  }
  await signInWithRedirect({ provider: redirectProvider });
};

/**
 * After Hosted UI returns, Amplify has written CognitoIdentityServiceProvider
 * keys. Re-hydrate the sync storage adapter and return a CognitoUser the rest
 * of the app (useCommon / refreshAuthNow) already understands.
 */
export const finalizeSocialSession = async () => {
  try {
    await hydrateCognitoStorageCache({ force: true });
  } catch { /* best effort */ }

  const session = await fetchAuthSession({ forceRefresh: true });
  const idToken = session?.tokens?.idToken?.toString?.();
  if (!idToken) {
    throw new Error('Social sign-in did not return a Cognito session. Please try again.');
  }

  let username = null;
  try {
    const amplifyUser = await getCurrentUser();
    username = amplifyUser?.username || amplifyUser?.userId || null;
  } catch { /* fall through to pool lookup */ }

  try {
    await flushCognitoStorageWrites({ timeoutMs: 5000 });
  } catch { /* best effort */ }

  let cognitoUser = null;
  try {
    cognitoUser = userPool.getCurrentUser();
  } catch { /* ignore */ }

  if (!cognitoUser && username) {
    try {
      cognitoUser = new CognitoUser({ Username: username, Pool: userPool });
    } catch { /* ignore */ }
  }

  return { cognitoUser, username, session };
};

export const signInWithGoogle = () => signInWithProvider('Google');
export const signInWithFacebook = () => signInWithProvider('Facebook');
export const signInWithApple = () => signInWithProvider('Apple');
// TikTok Login Kit is OAuth 2.0 rather than OIDC. Cognito therefore reaches it
// through the server-side custom OIDC bridge documented in SOCIAL_SIGNIN.md.
export const signInWithTikTok = () =>
  signInWithProvider('TikTok', { custom: 'TikTok' });

export default {
  isSocialAuthUiEnabled,
  isSocialAuthEnabled,
  isCognitoFederationConfigured,
  getCognitoHostedUiDomain,
  listSocialProvidersForUi,
  isSocialProviderVisible,
  isSocialProviderEnabled,
  getSocialProviderSetupMessage,
  finalizeSocialSession,
  signInWithGoogle,
  signInWithFacebook,
  signInWithApple,
  signInWithTikTok,
};
