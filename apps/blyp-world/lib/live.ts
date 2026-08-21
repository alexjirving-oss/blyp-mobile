import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
    increment,
    type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "./firebase";
import { liveServiceUrl } from "./env";
import { phoneLayoutModeFromStudio } from "./studioStageLayouts";

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
  try {
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
  } catch {
    // Unsigned / permission-denied: directory stays empty. Direct /live/:id
    // still works via the public program GET.
    return [];
  }
}

export async function fetchLiveById(id: string): Promise<LiveCard | null> {
  try {
    const db = getDb();
    let snap = await getDoc(doc(db, "liveStreams", id));
    if (!snap.exists()) {
      snap = await getDoc(doc(db, "streams", id));
    }
    if (!snap.exists()) return null;
    const card = normalizeLive(snap.id, snap.data() as Record<string, unknown>);

    if (!card.playbackUrl) {
      const alt = await getDoc(doc(db, "streams", id));
      if (alt.exists()) {
        const extra = normalizeLive(alt.id, alt.data() as Record<string, unknown>);
        if (extra.playbackUrl) card.playbackUrl = extra.playbackUrl;
      }
    }
    return card;
  } catch {
    return null;
  }
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

export type HostLiveSession = {
  sessionId: string;
  streamId: string;
  stageArn: string;
  hostToken: string;
  title: string;
  status: string;
  region?: string;
};

async function liveApiFetch<T>(
  path: string,
  idToken: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${liveServiceUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(body || {}),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg =
      (typeof json.error === "string" && json.error) ||
      (typeof json.detail === "string" && json.detail) ||
      (typeof json.message === "string" && json.message) ||
      `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json as T;
}

/** @returns true only when /health is OK after short retries (429 ≠ down). */
export async function checkLiveServiceHealth(): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${liveServiceUrl}/health`, {
        method: "GET",
        cache: "no-store",
      });
      if (res.ok) return true;
      // Rate-limited: service is up — do not treat as offline.
      if (res.status === 429) return true;
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
        continue;
      }
      return false;
    } catch {
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
        continue;
      }
      return false;
    }
  }
  return false;
}

/** Create a LIVE session via the same `/api/live/start` the mobile host uses. */
export async function startHostLiveSession(
  idToken: string,
  title: string,
): Promise<HostLiveSession> {
  const healthy = await checkLiveServiceHealth();
  if (!healthy) {
    throw new Error(
      "Live service is offline right now. Try again in a moment.",
    );
  }

  const data = await liveApiFetch<Record<string, unknown>>(
    "/api/live/start",
    idToken,
    { title: title.trim() || "LIVE" },
  );
  const session = (data.session || data) as Record<string, unknown>;
  const sessionId = pickStr(
    session.sessionId,
    session.streamId,
    data.sessionId,
    data.streamId,
  );
  const stageArn = pickStr(session.stageArn, data.stageArn);
  const hostToken = pickStr(
    data.hostToken,
    data.token,
    (data.tokens as Record<string, unknown> | undefined)?.hostToken,
    (data.tokens as Record<string, unknown> | undefined)?.host,
    session.hostToken,
  );
  if (!sessionId || !stageArn || !hostToken) {
    throw new Error("Live start response missing session, stage, or host token");
  }
  return {
    sessionId,
    streamId: sessionId,
    stageArn,
    hostToken,
    title: pickStr(session.title, title) || "LIVE",
    status: pickStr(session.status) || "LIVE",
    region: pickStr(session.region) || undefined,
  };
}

export async function endHostLiveSession(
  idToken: string,
  sessionId: string,
): Promise<void> {
  await liveApiFetch("/api/live/end", idToken, { sessionId });
}

export type LiveSessionStatus = {
  sessionId: string;
  live: boolean;
  status: string;
  hostUserId: string | null;
};

export async function getLiveSessionStatus(
  sessionId: string,
): Promise<LiveSessionStatus> {
  const id = String(sessionId || "").trim();
  if (!id) {
    return { sessionId: "", live: false, status: "MISSING", hostUserId: null };
  }
  try {
    const res = await fetch(
      `${liveServiceUrl}/api/live/session/${encodeURIComponent(id)}/status`,
      { method: "GET", cache: "no-store" },
    );
    if (!res.ok) {
      return { sessionId: id, live: false, status: "ERROR", hostUserId: null };
    }
    return (await res.json()) as LiveSessionStatus;
  } catch {
    return { sessionId: id, live: false, status: "ERROR", hostUserId: null };
  }
}

export type GuestRequest = {
  userId: string;
  status: string;
  requestedAt?: string;
  updatedAt?: string;
  sessionId?: string;
  slotIndex?: number;
};

async function liveApiGet<T>(
  path: string,
  idToken: string,
  queryParams?: Record<string, string>,
): Promise<T> {
  const qs = queryParams
    ? `?${new URLSearchParams(queryParams).toString()}`
    : "";
  const res = await fetch(`${liveServiceUrl}${path}${qs}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${idToken}` },
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg =
      (typeof json.error === "string" && json.error) ||
      (typeof json.detail === "string" && json.detail) ||
      `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json as T;
}

export async function listGuestRequests(
  idToken: string,
  sessionId: string,
): Promise<GuestRequest[]> {
  const data = await liveApiGet<{ requests?: GuestRequest[] }>(
    "/api/live/guest/requests",
    idToken,
    { sessionId },
  );
  return data.requests || [];
}

/** Viewer → host guest queue (POST /api/live/guest/request). */
export async function requestGuestSlot(
  idToken: string,
  sessionId: string,
  slotIndexRequested?: number,
): Promise<void> {
  const body: Record<string, unknown> = { sessionId };
  if (typeof slotIndexRequested === "number") {
    body.slotIndexRequested = slotIndexRequested;
  }
  await liveApiFetch("/api/live/guest/request", idToken, body);
}

export async function inviteGuest(
  idToken: string,
  sessionId: string,
  guestUserId: string,
): Promise<void> {
  await liveApiFetch("/api/live/guest/invite", idToken, {
    sessionId,
    guestUserId,
  });
}

export async function rejectGuest(
  idToken: string,
  sessionId: string,
  guestUserId: string,
): Promise<void> {
  await liveApiFetch("/api/live/guest/reject", idToken, {
    sessionId,
    guestUserId,
  });
}

export async function kickGuest(
  idToken: string,
  sessionId: string,
  guestUserId: string,
): Promise<void> {
  await liveApiFetch("/api/live/guest/kick", idToken, {
    sessionId,
    guestUserId,
  });
}

export async function muteGuest(
  idToken: string,
  sessionId: string,
  guestUserId: string,
  muted: boolean,
): Promise<void> {
  await liveApiFetch("/api/live/guest/mute", idToken, {
    sessionId,
    guestUserId,
    muted,
  });
}

export async function setGuestCamera(
  idToken: string,
  sessionId: string,
  guestUserId: string,
  cameraOff: boolean,
): Promise<void> {
  await liveApiFetch("/api/live/guest/camera", idToken, {
    sessionId,
    guestUserId,
    cameraOff,
  });
}

export async function hostInviteGuestByUid(
  idToken: string,
  sessionId: string,
  guestUserId: string,
): Promise<void> {
  await liveApiFetch("/api/live/guest/host-invite", idToken, {
    sessionId,
    guestUserId,
  });
}

export type StreamGiftSummary = {
  streamId: string;
  coinsReceived: number;
  gemsEarned: number;
  viewerGiftCount: number;
};

export async function fetchStreamGiftSummary(
  idToken: string,
  streamId: string,
): Promise<StreamGiftSummary | null> {
  try {
    const res = await fetch(
      `${liveServiceUrl}/economy/stream/${encodeURIComponent(streamId)}/summary`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${idToken}` },
        cache: "no-store",
      },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      streamId?: string;
      creator?: { coinsReceived?: number; gemsEarned?: number };
      viewer?: { giftCount?: number };
    };
    return {
      streamId: json.streamId || streamId,
      coinsReceived: Number(json.creator?.coinsReceived) || 0,
      gemsEarned: Number(json.creator?.gemsEarned) || 0,
      viewerGiftCount: Number(json.viewer?.giftCount) || 0,
    };
  } catch {
    return null;
  }
}

/** Per-recipient coin totals for the session (host/guests). Not sender-ranked. */
export type StreamGiftTotals = {
  streamId: string;
  byUser: Record<string, { coins: number; count: number }>;
};

export async function fetchStreamGiftTotals(
  idToken: string,
  streamId: string,
): Promise<StreamGiftTotals | null> {
  try {
    const res = await fetch(
      `${liveServiceUrl}/economy/stream/${encodeURIComponent(streamId)}/gift-totals`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${idToken}` },
        cache: "no-store",
      },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as StreamGiftTotals;
    return {
      streamId: json.streamId || streamId,
      byUser: json.byUser && typeof json.byUser === "object" ? json.byUser : {},
    };
  } catch {
    return null;
  }
}

export type SessionEngagementRow = {
  likes: number;
  shares: number;
  comments: number;
  coinsSpent: number;
  coinsReceived: number;
};

/** Redis engagement: coinsSpent ≈ sender spend; coinsReceived ≈ receiver haul. */
export async function fetchLiveEngagementSession(
  idToken: string,
  sessionId: string,
): Promise<Record<string, SessionEngagementRow> | null> {
  try {
    const res = await fetch(
      `${liveServiceUrl}/live/engagement/session?sessionId=${encodeURIComponent(sessionId)}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${idToken}` },
        cache: "no-store",
      },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      byUser?: Record<string, Partial<SessionEngagementRow>>;
    };
    const out: Record<string, SessionEngagementRow> = {};
    for (const [uid, row] of Object.entries(json.byUser || {})) {
      out[uid] = {
        likes: Number(row.likes) || 0,
        shares: Number(row.shares) || 0,
        comments: Number(row.comments) || 0,
        coinsSpent: Number(row.coinsSpent) || 0,
        coinsReceived: Number(row.coinsReceived) || 0,
      };
    }
    return out;
  } catch {
    return null;
  }
}

export type LiveGiftEventPayload = {
  streamId: string;
  giftEventId: string;
  giftId: string;
  quantity: number;
  coinSpent: number;
  sender?: { userId?: string; handle?: string | null };
  receiver?: { userId?: string; handle?: string | null };
  createdAt?: string;
};

export type TopGifterRow = {
  userId: string;
  name: string;
  coins: number;
};

/** Rank senders by coins spent (true top gifters). */
export function rankTopGifters(
  bySender: Record<string, { coins: number; name?: string }>,
  limit = 5,
): TopGifterRow[] {
  return Object.entries(bySender)
    .map(([userId, row]) => ({
      userId,
      name: (row.name || userId).slice(0, 24),
      coins: Math.max(0, Number(row.coins) || 0),
    }))
    .filter((r) => r.coins > 0)
    .sort((a, b) => b.coins - a.coins)
    .slice(0, limit);
}

/**
 * Socket.IO gift_event fan-out (same channel as mobile liveGiftSocket).
 * Soft-fails if socket cannot connect — caller keeps summary aggregates.
 */
export async function subscribeLiveGiftEvents(
  idToken: string,
  streamId: string,
  onGift: (payload: LiveGiftEventPayload) => void,
): Promise<() => void> {
  const { io } = await import("socket.io-client");
  const socket = io(liveServiceUrl, {
    autoConnect: false,
    transports: ["websocket"],
    auth: { token: idToken },
  });
  const join = () => {
    try {
      socket.emit("join", { streamId });
    } catch {
      /* ignore */
    }
  };
  const handler = (raw: unknown) => {
    if (!raw || typeof raw !== "object") return;
    const p = raw as LiveGiftEventPayload;
    if (!p.giftEventId && !p.coinSpent) return;
    onGift(p);
  };
  socket.on("connect", join);
  socket.on("gift_event", handler);
  socket.connect();
  return () => {
    try {
      socket.off("gift_event", handler);
      socket.off("connect", join);
      socket.emit("leave", { streamId });
      socket.disconnect();
    } catch {
      /* ignore */
    }
  };
}

export type LiveDirectoryGuest = {
  userId: string;
  displayName?: string;
  username?: string;
  photoURL?: string | null;
  slotIndex?: number;
  status?: string;
};

export type LiveStudioMirror = {
  id: string;
  title: string;
  status: string;
  viewerCount: number;
  peakViewerCount: number;
  playbackUrl: string | null;
  thumbnailUrl: string | null;
  category: string;
  tags: string[];
  guests: LiveDirectoryGuest[];
  lastHeartbeatAt: number | null;
  hostUid: string;
  /** Host studio broadcast framing — drives web watch / guest layout. */
  studioOrientation: "portrait" | "landscape" | null;
  studioLayout: string | null;
  /** Host program overlays (gifters/chat/goal/…) mirrored for web watch. */
  studioOverlayFeed: Record<string, unknown> | null;
};

function normalizeGuest(raw: unknown): LiveDirectoryGuest | null {
  if (!raw || typeof raw !== "object") return null;
  const g = raw as Record<string, unknown>;
  const userId = pickStr(g.userId, g.uid, g.id);
  if (!userId) return null;
  return {
    userId,
    displayName: pickStr(g.displayName, g.name) || undefined,
    username: pickStr(g.username, g.handle) || undefined,
    photoURL: pickStr(g.photoURL, g.avatarUrl) || null,
    slotIndex: typeof g.slotIndex === "number" ? g.slotIndex : undefined,
    status: pickStr(g.status) || undefined,
  };
}

function mirrorFromDoc(
  id: string,
  data: Record<string, unknown>,
): LiveStudioMirror {
  const tagsRaw = data.tags;
  const tags = Array.isArray(tagsRaw)
    ? tagsRaw.map((t) => String(t).trim()).filter(Boolean).slice(0, 8)
    : typeof tagsRaw === "string"
      ? tagsRaw
          .split(/[,#\s]+/)
          .map((t) => t.trim())
          .filter(Boolean)
          .slice(0, 8)
      : [];
  const guestsRaw = Array.isArray(data.guests) ? data.guests : [];
  const guests = guestsRaw
    .map(normalizeGuest)
    .filter((g): g is LiveDirectoryGuest => !!g);

  let lastHeartbeatAt: number | null = null;
  const hb = data.lastHeartbeatAt as
    | { toMillis?: () => number; seconds?: number }
    | string
    | number
    | null
    | undefined;
  try {
    if (hb && typeof hb === "object" && typeof hb.toMillis === "function") {
      lastHeartbeatAt = hb.toMillis();
    } else if (hb && typeof hb === "object" && typeof hb.seconds === "number") {
      lastHeartbeatAt = hb.seconds * 1000;
    } else if (typeof hb === "number") {
      lastHeartbeatAt = hb;
    } else if (typeof hb === "string") {
      const ms = Date.parse(hb);
      lastHeartbeatAt = Number.isFinite(ms) ? ms : null;
    }
  } catch {
    lastHeartbeatAt = null;
  }

  const orientRaw = pickStr(data.studioOrientation, data.orientation);
  const studioOrientation =
    orientRaw === "portrait" || orientRaw === "landscape" ? orientRaw : null;
  const studioLayout =
    pickStr(data.studioLayout, data.viewerLayout, data.layoutId) || null;
  const feedRaw = data.studioOverlayFeed;
  const studioOverlayFeed =
    feedRaw && typeof feedRaw === "object" && !Array.isArray(feedRaw)
      ? (feedRaw as Record<string, unknown>)
      : null;

  return {
    id,
    title: pickStr(data.title) || "LIVE",
    status: pickStr(data.status) || "unknown",
    viewerCount: Number(data.viewerCount) || 0,
    peakViewerCount: Number(data.peakViewerCount) || 0,
    playbackUrl:
      pickStr(
        data.playbackUrl,
        data.hlsUrl,
        (data.hls as Record<string, unknown> | undefined)?.playbackUrl,
      ) || null,
    thumbnailUrl: pickStr(data.thumbnailUrl, data.thumbUrl) || null,
    category: pickStr(data.category, data.topic) || "",
    tags,
    guests,
    lastHeartbeatAt,
    hostUid: pickStr(data.hostUid, data.userId),
    studioOrientation,
    studioLayout,
    studioOverlayFeed,
  };
}

/** Live Firestore mirror for the active session (viewers, guests, HLS, meta). */
export function subscribeLiveStudioMirror(
  sessionId: string,
  onData: (mirror: LiveStudioMirror | null) => void,
): Unsubscribe {
  const db = getDb();
  return onSnapshot(
    doc(db, "liveStreams", sessionId),
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      onData(mirrorFromDoc(snap.id, snap.data() as Record<string, unknown>));
    },
    () => onData(null),
  );
}

export type LiveChatComment = {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  text: string;
  createdAt: number;
  source?: "blyp" | "tiktok";
  kind?: "chat" | "gift";
};

/** Recent LIVE chat comments (Firestore subcollection). */
export function subscribeLiveChat(
  sessionId: string,
  onData: (comments: LiveChatComment[]) => void,
): Unsubscribe {
  const db = getDb();
  const q = query(
    collection(db, "liveStreams", sessionId, "comments"),
    orderBy("createdAt", "desc"),
    limit(40),
  );
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        let createdAt = Date.now();
        const c = data.createdAt as
          | { toMillis?: () => number; seconds?: number }
          | number
          | string
          | undefined;
        try {
          if (c && typeof c === "object" && typeof c.toMillis === "function") {
            createdAt = c.toMillis();
          } else if (c && typeof c === "object" && typeof c.seconds === "number") {
            createdAt = c.seconds * 1000;
          } else if (typeof c === "number") {
            createdAt = c;
          } else if (typeof c === "string") {
            createdAt = Date.parse(c) || Date.now();
          }
        } catch {
          /* keep now */
        }
        return {
          id: d.id,
          userId: pickStr(data.userId, data.uid),
          username: pickStr(data.username, data.handle) || "viewer",
          displayName:
            pickStr(data.displayName, data.username, data.handle) || "Viewer",
          text: pickStr(data.text, data.message, data.comment) || "",
          createdAt,
          source: "blyp" as const,
        };
      });
      onData(rows.filter((r) => r.text));
    },
    () => onData([]),
  );
}

export async function updateLiveSessionMeta(
  sessionId: string,
  patch: {
    title?: string;
    category?: string;
    tags?: string[];
    thumbnailUrl?: string;
    studioOrientation?: "portrait" | "landscape";
    studioLayout?: string;
    /** Cross-machine OBS overlay snapshot (same-origin write; public read if rules allow). */
    studioOverlayFeed?: Record<string, unknown>;
  },
): Promise<void> {
  const db = getDb();
  const payload: Record<string, unknown> = {
    updatedAt: Date.now(),
  };
  if (typeof patch.title === "string") payload.title = patch.title.trim();
  if (typeof patch.category === "string") {
    payload.category = patch.category.trim();
  }
  if (Array.isArray(patch.tags)) {
    payload.tags = patch.tags.map((t) => t.trim()).filter(Boolean).slice(0, 8);
  }
  if (typeof patch.thumbnailUrl === "string") {
    payload.thumbnailUrl = patch.thumbnailUrl.trim();
  }
  if (
    patch.studioOrientation === "portrait" ||
    patch.studioOrientation === "landscape"
  ) {
    payload.studioOrientation = patch.studioOrientation;
  }
  if (typeof patch.studioLayout === "string" && patch.studioLayout.trim()) {
    payload.studioLayout = patch.studioLayout.trim();
    // Phone watchers apply guestLayoutMode. Mirror Studio's program layout so
    // the app does not stay on the default bottom tray.
    const phoneMode = phoneLayoutModeFromStudio(payload.studioLayout as string);
    if (phoneMode) payload.guestLayoutMode = phoneMode;
  }
  if (patch.studioOverlayFeed && typeof patch.studioOverlayFeed === "object") {
    payload.studioOverlayFeed = patch.studioOverlayFeed;
  }
  await updateDoc(doc(db, "liveStreams", sessionId), payload  );
}

/**
 * Same Firestore viewerCount path as the Android watch client
 * (`LiveService.incrementViewer` → streams/{id} + liveStreams/{id}).
 * Requires a signed-in Firebase user (Cognito bridge or anonymous).
 */
export async function incrementLiveViewer(
  streamId: string,
  delta: number,
): Promise<boolean> {
  const id = String(streamId || "").trim();
  if (!id || !Number.isFinite(delta) || delta === 0) return false;
  const db = getDb();
  const payload: Record<string, unknown> = {
    viewerCount: increment(delta),
  };
  if (delta > 0) payload.totalViews = increment(delta);
  try {
    await updateDoc(doc(db, "streams", id), payload);
  } catch {
    return false;
  }
  try {
    const snap = await getDoc(doc(db, "streams", id));
    const data = snap.data() || {};
    const rawCount = typeof data.viewerCount === "number" ? data.viewerCount : 0;
    const clamped = Math.max(0, rawCount);
    const peak =
      typeof data.peakViewerCount === "number" ? data.peakViewerCount : 0;
    const corrections: Record<string, unknown> = {};
    if (rawCount !== clamped) corrections.viewerCount = clamped;
    if (clamped > peak) corrections.peakViewerCount = clamped;
    if (Object.keys(corrections).length > 0) {
      await updateDoc(doc(db, "streams", id), corrections);
    }
    await updateDoc(doc(db, "liveStreams", id), {
      viewerCount: clamped,
      ...(clamped > peak ? { peakViewerCount: clamped } : {}),
      ...(delta > 0 ? { totalViews: increment(delta) } : {}),
    });
  } catch {
    /* directory mirror is best-effort */
  }
  return true;
}

export type HostHistoryItem = {
  id: string;
  title: string;
  status: string;
  viewerCount: number;
  peakViewerCount: number;
  createdAt: number | null;
  thumbnailUrl: string | null;
};

export async function fetchHostLiveHistory(
  hostUid: string,
): Promise<HostHistoryItem[]> {
  if (!hostUid) return [];
  const db = getDb();
  let snap;
  try {
    snap = await getDocs(
      query(
        collection(db, "liveStreams"),
        where("hostUid", "==", hostUid),
        limit(30),
      ),
    );
  } catch {
    try {
      snap = await getDocs(
        query(
          collection(db, "liveStreams"),
          where("userId", "==", hostUid),
          limit(30),
        ),
      );
    } catch {
      return [];
    }
  }

  const items = snap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    let createdAt: number | null = null;
    const c = data.createdAt as
      | { toMillis?: () => number; seconds?: number }
      | number
      | string
      | undefined;
    try {
      if (c && typeof c === "object" && typeof c.toMillis === "function") {
        createdAt = c.toMillis();
      } else if (c && typeof c === "object" && typeof c.seconds === "number") {
        createdAt = c.seconds * 1000;
      } else if (typeof c === "number") {
        createdAt = c;
      } else if (typeof c === "string") {
        const ms = Date.parse(c);
        createdAt = Number.isFinite(ms) ? ms : null;
      }
    } catch {
      createdAt = null;
    }
    return {
      id: d.id,
      title: pickStr(data.title) || "LIVE",
      status: pickStr(data.status) || "unknown",
      viewerCount: Number(data.viewerCount) || 0,
      peakViewerCount: Number(data.peakViewerCount) || 0,
      createdAt,
      thumbnailUrl: pickStr(data.thumbnailUrl, data.thumbUrl) || null,
    };
  });

  return items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export const LIVE_CATEGORIES = [
  "Just chatting",
  "Gaming",
  "Music",
  "Comedy",
  "Sports",
  "Fitness",
  "Food",
  "Beauty",
  "Tech",
  "Travel",
] as const;

export function liveAppDeepLink(sessionId: string): string {
  return `blyp://live/${encodeURIComponent(sessionId)}`;
}

const STUDIO_SESSION_KEY = "blyp.world.liveStudio.activeSession";

export function persistStudioSession(session: HostLiveSession | null): void {
  try {
    if (!session) {
      sessionStorage.removeItem(STUDIO_SESSION_KEY);
      return;
    }
    sessionStorage.setItem(STUDIO_SESSION_KEY, JSON.stringify(session));
  } catch {
    /* ignore */
  }
}

export function loadPersistedStudioSession(): HostLiveSession | null {
  try {
    const raw = sessionStorage.getItem(STUDIO_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as HostLiveSession;
    if (!parsed?.sessionId || !parsed?.hostToken) return null;
    return parsed;
  } catch {
    return null;
  }
}
