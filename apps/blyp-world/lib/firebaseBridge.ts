"use client";

import { onAuthStateChanged, signInWithCustomToken } from "firebase/auth";
import { firebaseBridgeBaseUrl, liveServiceUrl, siteUrl } from "./env";
import { getFirebaseAuth } from "./firebase";

function waitForFirebaseUid(uid: string, timeoutMs = 10000): Promise<boolean> {
  const auth = getFirebaseAuth();
  if (auth.currentUser?.uid === uid) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      unsub();
      resolve(auth.currentUser?.uid === uid);
    }, timeoutMs);
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user?.uid === uid) {
        clearTimeout(timer);
        unsub();
        resolve(true);
      }
    });
  });
}

type MintPayload = {
  firebaseToken?: string;
  customToken?: string;
  uid?: string;
};

function extractToken(payload: MintPayload): string | null {
  const token = payload.firebaseToken || payload.customToken;
  return typeof token === "string" && token.trim() ? token.trim() : null;
}

/**
 * Mint endpoints, in preference order:
 * 1) Same-origin Netlify proxy (no CORS)
 * 2) live-service /auth/firebase-token (allows https://blyp.world)
 * 3) Cloud Functions mintFirebaseCustomToken (mobile path; CORS often missing blyp.world)
 */
function mintCandidates(): string[] {
  const urls: string[] = [];
  if (typeof window !== "undefined") {
    urls.push(`${window.location.origin}/api/auth/firebase-token`);
    // Absolute site URL when origin is a Netlify preview alias
    if (siteUrl && !urls.includes(`${siteUrl}/api/auth/firebase-token`)) {
      urls.push(`${siteUrl}/api/auth/firebase-token`);
    }
  }
  urls.push(`${liveServiceUrl}/auth/firebase-token`);
  urls.push(`${firebaseBridgeBaseUrl}/mintFirebaseCustomToken`);
  return Array.from(new Set(urls.filter(Boolean)));
}

async function mintCustomToken(
  cognitoIdToken: string,
  uid: string,
): Promise<string | null> {
  let lastErr = "";
  for (const url of mintCandidates()) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cognitoIdToken}`,
        },
        body: JSON.stringify({ uid }),
      });
      const payload = (await res.json().catch(() => ({}))) as MintPayload & {
        error?: string;
        detail?: string;
      };
      if (!res.ok) {
        lastErr = payload.detail || payload.error || `HTTP ${res.status}`;
        continue;
      }
      const token = extractToken(payload);
      if (token) return token;
      lastErr = "mint response missing token";
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }
  if (typeof console !== "undefined") {
    console.warn("[firebaseBridge] mint failed:", lastErr);
  }
  return null;
}

/** Mint Firebase custom token from Cognito ID token (same uid = Cognito sub as the app). */
export async function ensureFirebaseFromCognito(opts: {
  cognitoIdToken: string;
  uid: string;
}): Promise<boolean> {
  const auth = getFirebaseAuth();
  if (auth.currentUser?.uid === opts.uid) return true;
  if (!opts.cognitoIdToken || !opts.uid) return false;

  try {
    const token = await mintCustomToken(opts.cognitoIdToken, opts.uid);
    if (!token) return false;
    await signInWithCustomToken(auth, token);
    if (auth.currentUser?.uid === opts.uid) return true;
    return waitForFirebaseUid(opts.uid);
  } catch (e) {
    if (typeof console !== "undefined") {
      console.warn(
        "[firebaseBridge] signInWithCustomToken failed:",
        e instanceof Error ? e.message : e,
      );
    }
    return false;
  }
}
