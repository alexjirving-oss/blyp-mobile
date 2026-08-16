"use client";

import { signInWithCustomToken } from "firebase/auth";
import { firebaseBridgeBaseUrl } from "./env";
import { getFirebaseAuth } from "./firebase";

/** Mint Firebase custom token from Cognito ID token (same bridge as the app). */
export async function ensureFirebaseFromCognito(opts: {
  cognitoIdToken: string;
  uid: string;
}): Promise<boolean> {
  const auth = getFirebaseAuth();
  if (auth.currentUser?.uid === opts.uid) return true;

  const url = `${firebaseBridgeBaseUrl}/mintFirebaseCustomToken`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.cognitoIdToken}`,
      },
      body: JSON.stringify({ uid: opts.uid }),
    });
    if (!res.ok) return false;
    const payload = (await res.json()) as {
      firebaseToken?: string;
      customToken?: string;
    };
    const token = payload.firebaseToken || payload.customToken;
    if (!token) return false;
    await signInWithCustomToken(auth, token);
    return true;
  } catch {
    return false;
  }
}
