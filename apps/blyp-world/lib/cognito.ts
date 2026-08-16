"use client";

import {
  AuthenticationDetails,
  CognitoRefreshToken,
  CognitoUser,
  CognitoUserPool,
  CognitoUserSession,
} from "amazon-cognito-identity-js";
import { cognito } from "./env";

const STORAGE_KEY = "blyp.world.cognito.v1";

export type BlypSession = {
  sub: string;
  email: string;
  username: string;
  idToken: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

function pool(): CognitoUserPool {
  return new CognitoUserPool({
    UserPoolId: cognito.userPoolId,
    ClientId: cognito.clientId,
  });
}

function sessionToBlyp(session: CognitoUserSession): BlypSession {
  const id = session.getIdToken();
  const payload = id.decodePayload() as Record<string, string>;
  return {
    sub: String(payload.sub || ""),
    email: String(payload.email || ""),
    username: String(
      payload.preferred_username || payload["cognito:username"] || payload.email || "",
    ),
    idToken: id.getJwtToken(),
    accessToken: session.getAccessToken().getJwtToken(),
    refreshToken: session.getRefreshToken().getToken(),
    expiresAt: id.getExpiration() * 1000,
  };
}

export function loadStoredSession(): BlypSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BlypSession;
    if (!parsed?.idToken || !parsed?.sub) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function persistSession(session: BlypSession | null) {
  if (typeof window === "undefined") return;
  if (!session) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function signInWithPassword(
  email: string,
  password: string,
): Promise<BlypSession> {
  const username = email.trim().toLowerCase();
  const user = new CognitoUser({ Username: username, Pool: pool() });
  const details = new AuthenticationDetails({
    Username: username,
    Password: password,
  });

  return new Promise((resolve, reject) => {
    user.authenticateUser(details, {
      onSuccess: (session) => {
        const blyp = sessionToBlyp(session);
        persistSession(blyp);
        resolve(blyp);
      },
      onFailure: (err) => reject(err),
      newPasswordRequired: () =>
        reject(new Error("NEW_PASSWORD_REQUIRED — finish signup in the Blyp app first.")),
    });
  });
}

export function signOutLocal() {
  persistSession(null);
  try {
    const current = pool().getCurrentUser();
    current?.signOut();
  } catch {
    // ignore
  }
}

export async function refreshSessionIfNeeded(
  session: BlypSession | null,
): Promise<BlypSession | null> {
  if (!session) return null;
  if (session.expiresAt > Date.now() + 60_000) return session;

  const user = pool().getCurrentUser();
  if (!user) {
    // Reconstruct from stored username/email
    const reconstructed = new CognitoUser({
      Username: session.email || session.username,
      Pool: pool(),
    });
    return refreshWithUser(reconstructed, session);
  }
  return refreshWithUser(user, session);
}

function refreshWithUser(
  user: CognitoUser,
  previous: BlypSession,
): Promise<BlypSession | null> {
  return new Promise((resolve) => {
    user.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session || !session.isValid()) {
        try {
          const token = new CognitoRefreshToken({
            RefreshToken: previous.refreshToken,
          });
          user.refreshSession(token, (e2, fresh) => {
            if (e2 || !fresh) {
              persistSession(null);
              resolve(null);
              return;
            }
            const blyp = sessionToBlyp(fresh);
            persistSession(blyp);
            resolve(blyp);
          });
        } catch {
          persistSession(null);
          resolve(null);
        }
        return;
      }
      const blyp = sessionToBlyp(session);
      persistSession(blyp);
      resolve(blyp);
    });
  });
}

export function hostedUiLoginUrl(redirectUri: string): string {
  const domain = cognito.domain.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const params = new URLSearchParams({
    client_id: cognito.clientId,
    response_type: "token",
    scope: "openid email profile",
    redirect_uri: redirectUri,
  });
  return `https://${domain}/login?${params.toString()}`;
}
