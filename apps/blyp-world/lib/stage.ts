import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
} from "firebase/firestore";
import { getDb } from "./firebase";
import { fetchPostById, type FeedPost } from "./feed";

export type StageTheme = {
  id: string;
  label: string;
  colors: {
    bg: string;
    surface: string;
    accent: string;
    accentSoft: string;
    text: string;
    textMuted: string;
    border: string;
    coverFallback: [string, string];
  };
};

const THEMES: StageTheme[] = [
  {
    id: "midnight_teal",
    label: "Midnight Teal",
    colors: {
      bg: "#0A0A0C",
      surface: "#141418",
      accent: "#00D2BE",
      accentSoft: "rgba(0,210,190,0.16)",
      text: "#F5F5F7",
      textMuted: "#9CA3AF",
      border: "#27272E",
      coverFallback: ["#0B1F1C", "#00D2BE"],
    },
  },
  {
    id: "neon_dusk",
    label: "Neon Dusk",
    colors: {
      bg: "#0C0A12",
      surface: "#17141F",
      accent: "#67E8F9",
      accentSoft: "rgba(103,232,249,0.14)",
      text: "#F8FAFC",
      textMuted: "#A5B4C8",
      border: "#2A2438",
      coverFallback: ["#1A1030", "#67E8F9"],
    },
  },
  {
    id: "ember_stage",
    label: "Ember Stage",
    colors: {
      bg: "#100C0A",
      surface: "#1A1410",
      accent: "#F59E0B",
      accentSoft: "rgba(245,158,11,0.14)",
      text: "#FFF7ED",
      textMuted: "#C4B5A0",
      border: "#3A2E22",
      coverFallback: ["#2A1608", "#F59E0B"],
    },
  },
  {
    id: "arctic_signal",
    label: "Arctic Signal",
    colors: {
      bg: "#080B10",
      surface: "#10151C",
      accent: "#38BDF8",
      accentSoft: "rgba(56,189,248,0.14)",
      text: "#F1F5F9",
      textMuted: "#94A3B8",
      border: "#1E293B",
      coverFallback: ["#0F172A", "#38BDF8"],
    },
  },
  {
    id: "rose_garage",
    label: "Rose Garage",
    colors: {
      bg: "#0E0A0C",
      surface: "#1A1216",
      accent: "#FB7185",
      accentSoft: "rgba(251,113,133,0.14)",
      text: "#FFF1F2",
      textMuted: "#C4A4AB",
      border: "#3F2A32",
      coverFallback: ["#2A1018", "#FB7185"],
    },
  },
];

function pickStr(...vals: unknown[]): string {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

export type StageModel = {
  userId: string;
  username: string;
  displayName: string;
  bio: string;
  photoURL: string | null;
  verified: boolean;
  vibe: string;
  coverUrl: string | null;
  theme: StageTheme;
  links: { id: string; label: string; url: string }[];
  topCircle: string[];
  pinnedPostIds: string[];
  liveStreamId: string | null;
};

export function getTheme(themeId?: string | null): StageTheme {
  const id = String(themeId || "").trim();
  return THEMES.find((t) => t.id === id) || THEMES[0]!;
}

function normalizeStage(userId: string, data: Record<string, unknown>): StageModel {
  const stage = (data.stage && typeof data.stage === "object"
    ? data.stage
    : {}) as Record<string, unknown>;
  const username = pickStr(data.username, data.handle, data.displayName) || "user";
  const handle = username.startsWith("@") ? username.slice(1) : username;
  const stageName = pickStr(stage.displayName);
  const theme = getTheme(pickStr(stage.themeId) || "midnight_teal");
  const links = (Array.isArray(stage.links) ? stage.links : [])
    .map((l, i) => {
      if (!l || typeof l !== "object") return null;
      const row = l as Record<string, unknown>;
      const url = pickStr(row.url, row.href);
      if (!url) return null;
      return {
        id: pickStr(row.id) || `lnk_${i}`,
        label: pickStr(row.label, row.title) || `Link ${i + 1}`,
        url,
      };
    })
    .filter(Boolean) as { id: string; label: string; url: string }[];

  return {
    userId,
    username: handle,
    displayName: stageName || pickStr(data.displayName, handle) || handle,
    bio: pickStr(data.bio),
    photoURL: pickStr(data.photoURL, data.avatar) || null,
    verified: data.verified === true || data.isVerified === true,
    vibe: pickStr(stage.vibe),
    coverUrl: pickStr(stage.coverUrl) || null,
    theme,
    links: links.slice(0, 5),
    topCircle: (Array.isArray(stage.topCircle) ? stage.topCircle : [])
      .map((id) => String(id || "").trim())
      .filter(Boolean)
      .slice(0, 8),
    pinnedPostIds: (Array.isArray(stage.pinnedPostIds) ? stage.pinnedPostIds : [])
      .map((id) => String(id || "").trim())
      .filter(Boolean)
      .slice(0, 3),
    liveStreamId:
      String(data.status || "").toLowerCase() === "live"
        ? pickStr(data.streamId, data.liveStreamId) || null
        : null,
  };
}

export async function resolveUsernameToUid(username: string): Promise<string | null> {
  const key = username.replace(/^@/, "").trim().toLowerCase();
  if (!key) return null;
  const db = getDb();

  const claim = await getDoc(doc(db, "usernameClaims", key));
  if (claim.exists()) {
    const uid = pickStr(claim.data()?.uid);
    if (uid) return uid;
  }

  // Fallback: query users by username / usernameKey / handle
  for (const field of ["usernameKey", "username", "handle"] as const) {
    const value = field === "usernameKey" ? key : username.replace(/^@/, "").trim();
    const snap = await getDocs(
      query(collection(db, "users"), where(field, "==", value), limit(1)),
    );
    if (!snap.empty) return snap.docs[0]!.id;
  }

  // Last resort: treat path segment as uid
  const byId = await getDoc(doc(db, "users", username.replace(/^@/, "").trim()));
  if (byId.exists()) return byId.id;
  return null;
}

export async function fetchStageByUsername(
  username: string,
): Promise<{ stage: StageModel; pinned: FeedPost[] } | null> {
  const uid = await resolveUsernameToUid(username);
  if (!uid) return null;
  const db = getDb();
  const snap = await getDoc(doc(db, "users", uid));
  const data = snap.exists() ? (snap.data() as Record<string, unknown>) : {};
  const stage = normalizeStage(uid, data);
  const pinned = (
    await Promise.all(stage.pinnedPostIds.map((id) => fetchPostById(id)))
  ).filter(Boolean) as FeedPost[];
  return { stage, pinned };
}
