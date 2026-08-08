// Minimal auth adapter centralizing Amplify v6 calls
// Non-breaking introduction: screens can adopt this without changing behavior elsewhere

import { mapAuthError } from './errors';
import { rememberPendingProfile } from '../../services/usernameProfileService';

// Amplify v6 modular Auth imports
// Note: Ensure Amplify.configure(...) is called once at app bootstrap (already present per logs)
import {
  signIn as amplifySignIn,
  signUp as amplifySignUp,
  signOut as amplifySignOut,
  confirmSignUp as amplifyConfirmSignUp,
  resendSignUpCode as amplifyResendSignUpCode,
  fetchAuthSession,
  getCurrentUser as amplifyGetCurrentUser,
} from 'aws-amplify/auth';

export async function signUp({ email, password, username }) {
  try {
    const publicUsername = String(username || '').trim().replace(/^@/, '');
    const looksOpaque =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(publicUsername);
    if (!/^[A-Za-z0-9_.]{3,20}$/.test(publicUsername) || looksOpaque) {
      throw new Error('A valid public username is required to create an account.');
    }
    const res = await amplifySignUp({
      username: email,
      password,
      options: {
        userAttributes: {
          email,
          preferred_username: publicUsername,
          name: publicUsername,
        },
        autoSignIn: true, // attempt auto sign-in after confirmation
      },
    });
    await rememberPendingProfile({ source: 'signup', username: publicUsername });
    return res; // { isSignUpComplete, nextStep, userId }
  } catch (err) {
    throw mapAuthError(err);
  }
}

export async function confirmSignUp({ email, code }) {
  try {
    return await amplifyConfirmSignUp({ username: email, confirmationCode: code });
  } catch (err) {
    throw mapAuthError(err);
  }
}

export async function resendCode({ email }) {
  try {
    return await amplifyResendSignUpCode({ username: email });
  } catch (err) {
    throw mapAuthError(err);
  }
}

export async function signIn({ email, password }) {
  try {
    const res = await amplifySignIn({ username: email, password });
    return res; // { isSignedIn, nextStep }
  } catch (err) {
    throw mapAuthError(err);
  }
}

export async function signOut() {
  try {
    await amplifySignOut();
  } catch (err) {
    throw mapAuthError(err);
  }
}

export async function getCurrentUser() {
  try {
    return await amplifyGetCurrentUser(); // { userId, username, signInDetails }
  } catch (err) {
    // when not signed-in, v6 throws; return null for convenience
    return null;
  }
}

export async function getSession() {
  try {
    const s = await fetchAuthSession();
    // s.tokens may be undefined when signed-out
    return s;
  } catch (err) {
    throw mapAuthError(err);
  }
}

export async function getIdToken() {
  const s = await getSession();
  return s?.tokens?.idToken?.toString?.() || null;
}

export async function isAuthenticated() {
  const token = await getIdToken();
  return !!token;
}

// Poll-friendly helper to validate token shape safely
export function isJwtLike(str) {
  return typeof str === 'string' && /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(str);
}
