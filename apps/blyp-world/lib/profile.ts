"use client";

import { doc, getDoc } from "firebase/firestore";
import { getDb } from "./firebase";

export type MeProfile = {
  uid: string;
  username: string;
  displayName: string;
  photoURL: string | null;
};

function pickStr(...vals: unknown[]): string {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function resolvePhoto(data: Record<string, unknown>): string | null {
  return (
    pickStr(
      data.photoURL,
      data.avatar,
      data.userPhotoURL,
      data.photo,
      data.profilePhoto,
      data.profilePicture,
    ) || null
  );
}

/** Load public profile for chrome avatar — same sources as mobile (users + userProfiles). */
export async function loadMeProfile(
  uid: string,
  fallbackUsername = "",
): Promise<MeProfile | null> {
  if (!uid) return null;
  const db = getDb();
  try {
    const [userSnap, profileSnap] = await Promise.all([
      getDoc(doc(db, "users", uid)),
      getDoc(doc(db, "userProfiles", uid)),
    ]);
    const user = userSnap.exists()
      ? (userSnap.data() as Record<string, unknown>)
      : {};
    const profile = profileSnap.exists()
      ? (profileSnap.data() as Record<string, unknown>)
      : {};
    const looksLikeEmail = (s: string) =>
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
    const pickHandle = (...vals: unknown[]) => {
      const emails: string[] = [];
      for (const v of vals) {
        if (typeof v !== "string" || !v.trim()) continue;
        const h = v.trim().startsWith("@") ? v.trim().slice(1) : v.trim();
        if (!h) continue;
        if (looksLikeEmail(h)) {
          emails.push(h);
          continue;
        }
        return h;
      }
      if (emails[0]) return emails[0].split("@")[0] || emails[0];
      return "";
    };
    const username =
      pickHandle(
        user.username,
        user.handle,
        profile.username,
        profile.handle,
        fallbackUsername,
      ) || uid.slice(0, 8);
    const displayRaw = pickStr(user.displayName, profile.displayName, username);
    const displayName =
      displayRaw && !looksLikeEmail(displayRaw)
        ? displayRaw
        : username;
    return {
      uid,
      username,
      displayName,
      photoURL: resolvePhoto(user) || resolvePhoto(profile),
    };
  } catch (e) {
    if (typeof console !== "undefined") {
      console.warn(
        "[profile] loadMeProfile failed:",
        e instanceof Error ? e.message : e,
      );
    }
    return {
      uid,
      username: fallbackUsername || uid.slice(0, 8),
      displayName: fallbackUsername || uid.slice(0, 8),
      photoURL: null,
    };
  }
}
