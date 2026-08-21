"use client";

import { signInAnonymously } from "firebase/auth";
import { ensureFirebaseFromCognito } from "./firebaseBridge";
import { getFirebaseAuth } from "./firebase";
import { incrementLiveViewer } from "./live";
import { liveServiceUrl } from "./env";

const PRESENCE_RE = /^[A-Za-z0-9._:-]{8,128}$/;

function presenceStorageKey(sessionId: string): string {
  return `blyp.watchPresence.v1:${sessionId}`;
}

function newPresenceId(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return `web-${crypto.randomUUID()}`;
    }
  } catch {
    /* ignore */
  }
  return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function readPresenceId(sessionId: string): string {
  if (typeof window === "undefined") return newPresenceId();
  try {
    const existing = window.sessionStorage.getItem(presenceStorageKey(sessionId));
    if (existing && PRESENCE_RE.test(existing)) return existing;
    const next = newPresenceId();
    window.sessionStorage.setItem(presenceStorageKey(sessionId), next);
    return next;
  } catch {
    return newPresenceId();
  }
}

async function postPresence(
  sessionId: string,
  presenceId: string,
  action: "join" | "leave",
): Promise<boolean> {
  const body = JSON.stringify({ sessionId, presenceId, action });
  const urls = [
    typeof window !== "undefined"
      ? `${window.location.origin}/api/live/watch-presence`
      : "",
    `${liveServiceUrl}/api/live/watch/${encodeURIComponent(sessionId)}/presence`,
  ].filter(Boolean);
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: action === "leave",
      });
      if (res.ok) return true;
    } catch {
      /* try next */
    }
  }
  return false;
}

async function ensureWatchFirebase(opts: {
  cognitoIdToken?: string | null;
  uid?: string | null;
}): Promise<boolean> {
  if (opts.cognitoIdToken && opts.uid) {
    const bridged = await ensureFirebaseFromCognito({
      cognitoIdToken: opts.cognitoIdToken,
      uid: opts.uid,
    });
    if (bridged) return true;
  }
  const auth = getFirebaseAuth();
  if (auth.currentUser) return true;
  try {
    await signInAnonymously(auth);
    return !!auth.currentUser;
  } catch {
    return false;
  }
}

/**
 * Register this browser tab on the same viewerCount the phone uses.
 * Incognito is unsigned, so we try public presence then anonymous Firebase.
 */
export function startWatchPresence(
  sessionId: string,
  opts?: { cognitoIdToken?: string | null; uid?: string | null },
): () => void {
  const id = String(sessionId || "").trim();
  if (!id || typeof window === "undefined") return () => undefined;
  const presenceId = readPresenceId(id);
  let stopped = false;
  const joinedKey = `blyp.watchJoined.v1:${id}:${presenceId}`;

  const join = async () => {
    if (stopped) return;
    try {
      if (window.sessionStorage.getItem(joinedKey)) return;
    } catch {
      /* continue */
    }
    const posted = await postPresence(id, presenceId, "join");
    if (posted) {
      try {
        window.sessionStorage.setItem(joinedKey, "1");
      } catch {
        /* ignore */
      }
      return;
    }
    const authed = await ensureWatchFirebase({
      cognitoIdToken: opts?.cognitoIdToken,
      uid: opts?.uid,
    });
    if (!authed || stopped) return;
    const ok = await incrementLiveViewer(id, 1);
    if (ok) {
      try {
        window.sessionStorage.setItem(joinedKey, "1");
      } catch {
        /* ignore */
      }
    }
  };

  const leave = () => {
    if (stopped) return;
    stopped = true;
    let wasJoined = false;
    try {
      wasJoined = window.sessionStorage.getItem(joinedKey) === "1";
      window.sessionStorage.removeItem(joinedKey);
    } catch {
      /* ignore */
    }
    if (!wasJoined) return;
    void (async () => {
      const posted = await postPresence(id, presenceId, "leave");
      if (!posted) {
        await incrementLiveViewer(id, -1).catch(() => undefined);
      }
    })();
  };

  void join();
  window.addEventListener("pagehide", leave);
  return () => {
    window.removeEventListener("pagehide", leave);
    leave();
  };
}
