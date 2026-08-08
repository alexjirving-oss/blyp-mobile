// Cognito Hosted UI federation. Provider tokens stay behind Cognito; the app
// receives the same user-pool session used by password sign-in.
import { signInWithRedirect } from 'aws-amplify/auth';

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
    return isCognitoFederationConfigured();
  } catch {
    return false;
  }
};

/** True when Cognito Hosted UI domain is configured for IdP federation. */
export const isCognitoFederationConfigured = () => {
  const domain = String(readEnv('EXPO_PUBLIC_COGNITO_DOMAIN') || '').trim();
  return domain.length > 0;
};

const configuredProviders = () => {
  const raw = String(
    readEnv('EXPO_PUBLIC_SOCIAL_PROVIDERS') || 'Google,Facebook'
  );
  return new Set(
    raw.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean)
  );
};

export const isSocialProviderEnabled = (provider) =>
  isSocialAuthEnabled() && configuredProviders().has(String(provider || '').toLowerCase());

const signInWithProvider = async (provider, redirectProvider = provider) => {
  if (!isSocialProviderEnabled(provider)) {
    throw new Error(`${provider} sign-in is not configured for this build.`);
  }
  await signInWithRedirect({ provider: redirectProvider });
};

export const signInWithGoogle = () => signInWithProvider('Google');
export const signInWithFacebook = () => signInWithProvider('Facebook');
export const signInWithApple = () => signInWithProvider('Apple');
// TikTok Login Kit is OAuth 2.0 rather than OIDC. Cognito therefore reaches it
// through the server-side custom OIDC bridge documented in SOCIAL_SIGNIN.md.
export const signInWithTikTok = () =>
  signInWithProvider('TikTok', { custom: 'TikTok' });

export default {
  isSocialAuthEnabled,
  isCognitoFederationConfigured,
  isSocialProviderEnabled,
  signInWithGoogle,
  signInWithFacebook,
  signInWithApple,
  signInWithTikTok,
};
