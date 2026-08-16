import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { getDb } from "./firebase";
import { liveServiceUrl } from "./env";

export type LiveCard = {
  id: string;
  streamId: string;
  title: string;
  hostUid: string;
  hostUsername: string;
  hostDisplayName: string;
  hostPhotoURL: string | null;
  thumbnailUrl: string | null;
  viewerCount: number;
  playbackUrl: string | null;
  status: string;
  directoryReady: boolean;
};

function pickStr(...vals: unknown[]): string {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function isFreshHeartbeat(data: Record<string, unknown>): boolean {
  const hb = data.lastHeartbeatAt as { seconds?: number; toMillis?: () => number } | null;
  if (!hb) return true; // fail open if missing — status+directoryReady still gate
  try {
    const ms =
      typeof hb.toMillis === "function"
        ? hb.toMillis()
        : typeof hb.seconds === "number"
          ? hb.seconds * 1000
          : Date.parse(String(hb));
    if (!Number.isFinite(ms)) return true;
    return Date.now() - ms < 90_000;
  } catch {
    return true;
  }
}

function normalizeLive(id: string, data: Record<string, unknown>): LiveCard {
  return {
    id,
    streamId: pickStr(data.streamId, id),
    title: pickStr(data.title) || "LIVE",
    hostUid: pickStr(data.hostUid, data.userId),
    hostUsername: pickStr(data.hostUsername, data.username) || "host",
    hostDisplayName: pickStr(data.hostDisplayName, data.displayName) || "Host",
    hostPhotoURL: pickStr(data.hostPhotoURL, data.photoURL) || null,
    thumbnailUrl: pickStr(data.thumbnailUrl, data.thumbUrl) || null,
    viewerCount: Number(data.viewerCount) || 0,
    playbackUrl:
      pickStr(
        data.playbackUrl,
        data.hlsUrl,
        (data.hls as Record<string, unknown> | undefined)?.playbackUrl,
      ) || null,
    status: pickStr(data.status) || "unknown",
    directoryReady: data.directoryReady !== false,
  };
}

export async function fetchLiveDirectory(): Promise<LiveCard[]> {
  const db = getDb();
  const snap = await getDocs(collection(db, "liveStreams"));
  const cards = snap.docs
    .map((d) => normalizeLive(d.id, d.data() as Record<string, unknown>))
    .filter(
      (c) =>
        c.status.toLowerCase() === "live" &&
        c.directoryReady &&
        isFreshHeartbeat(
          (snap.docs.find((d) => d.id === c.id)?.data() || {}) as Record<
            string,
            unknown
          >,
        ),
    )
    .sort((a, b) => b.viewerCount - a.viewerCount);
  return cards;
}

export async function fetchLiveById(id: string): Promise<LiveCard | null> {
  const db = getDb();
  let snap = await getDoc(doc(db, "liveStreams", id));
  if (!snap.exists()) {
    snap = await getDoc(doc(db, "streams", id));
  }
  if (!snap.exists()) return null;
  const card = normalizeLive(snap.id, snap.data() as Record<string, unknown>);

  // Enrich playback from streams doc when liveStreams lacks URL
  if (!card.playbackUrl) {
    const alt = await getDoc(doc(db, "streams", id));
    if (alt.exists()) {
      const extra = normalizeLive(alt.id, alt.data() as Record<string, unknown>);
      if (extra.playbackUrl) card.playbackUrl = extra.playbackUrl;
    }
  }
  return card;
}

/** Authenticated mass-join for HLS playback URL when directory lacks one. */
export async function joinLiveMass(
  sessionId: string,
  idToken: string,
): Promise<{ playbackUrl?: string; mode?: string } | null> {
  try {
    const res = await fetch(`${liveServiceUrl}/api/live/mass/join`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ streamId: sessionId, sessionId }),
    });
    if (!res.ok) return null;
    return (await res.json()) as { playbackUrl?: string; mode?: string };
  } catch {
    return null;
  }
}
