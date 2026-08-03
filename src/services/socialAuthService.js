/**
 * Social authentication (Google / Facebook) — DISABLED for production.
 *
 * The previous implicit-token flow never established Cognito/Firebase identity
 * and is not safe to ship. Re-enable only with authorization-code + PKCE and a
 * server-side federation exchange.
 */

export const isSocialAuthEnabled = () => false;

export const signInWithGoogle = async () => {
  throw new Error('SOCIAL_AUTH_DISABLED');
};

export const signInWithFacebook = async () => {
  throw new Error('SOCIAL_AUTH_DISABLED');
};

export default {
  isSocialAuthEnabled,
  signInWithGoogle,
  signInWithFacebook,
};
