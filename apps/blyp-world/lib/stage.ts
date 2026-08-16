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
import {
  fetchPostById,
  fetchPostsByUserId,
  pickPublicHandle,
  type FeedPost,
} from "./feed";
import {
  getFollowersCount,
  getFollowingCount,
  getFollowingIds,
  hydrateProfiles,
  type SocialProfile,
} from "./social";

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

function looksLikeEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function humanizeId(id: string): string {
  return id
    .replace(/^(club_|badge_)/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export type StageFlair = { id: string; label: string; kind: "club" | "badge" };

export type PastLiveItem = {
  id: string;
  title: string;
  thumbnailUrl: string | null;
  peakViewerCount: number;
  likes: number;
  endedAtMs: number | null;
};

export type StageModel = {
  userId: string;
  username: string;
  displayName: string;
  bio: string;
  pronouns: string;
  location: string;
  photoURL: string | null;
  verified: boolean;
  vibe: string;
  coverUrl: string | null;
  theme: StageTheme;
  links: { id: string; label: string; url: string }[];
  topCircle: string[];
  pinnedPostIds: string[];
  liveStreamId: string | null;
  flair: StageFlair[];
  stats: {
    posts: number;
    followers: number;
    following: number;
    likes: number;
  };
};

export type StagePayload = {
  stage: StageModel;
  pinned: FeedPost[];
  posts: FeedPost[];
  topCircle: SocialProfile[];
  pastLives: PastLiveItem[];
};

export function getTheme(themeId?: string | null): StageTheme {
  const id = String(themeId || "").trim();
  return THEMES.find((t) => t.id === id) || THEMES[0]!;
}

function pastLiveToMillis(value: unknown): number | null {
  if (!value) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof (value as { toMillis?: () => number }).toMillis === "function") {
    try {
      return (value as { toMillis: () => number }).toMillis();
    } catch {
      return null;
    }
  }
  if (typeof (value as { seconds?: number }).seconds === "number") {
    return (value as { seconds: number }).seconds * 1000;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeFlair(data: Record<string, unknown>): StageFlair[] {
  const clubs = Array.isArray(data.profileClubs) ? data.profileClubs : [];
  const badges = Array.isArray(data.profileBadges) ? data.profileBadges : [];
  const out: StageFlair[] = [];
  const seen = new Set<string>();
  for (const item of clubs) {
    const id =
      typeof item === "string"
        ? item.trim()
        : pickStr((item as Record<string, unknown>)?.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label: humanizeId(id), kind: "club" });
  }
  for (const item of badges) {
    const id =
      typeof item === "string"
        ? item.trim()
        : pickStr((item as Record<string, unknown>)?.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label: humanizeId(id), kind: "badge" });
  }
  return out.slice(0, 12);
}

function normalizeStage(
  userId: string,
  data: Record<string, unknown>,
  profile: Record<string, unknown>,
): StageModel {
  const stage = (
    data.stage && typeof data.stage === "object" ? data.stage : {}
  ) as Record<string, unknown>;
  const username = pickPublicHandle(
    data.username,
    data.handle,
    profile.username,
    profile.handle,
    data.displayName,
    profile.displayName,
  );
  const handle =
    username === "creator" ? userId.slice(0, 8) : username.replace(/^@/, "");
  const displayRaw = pickStr(
    stage.displayName,
    data.displayName,
    profile.displayName,
    handle,
  );
  const displayName =
    displayRaw && !looksLikeEmail(displayRaw) ? displayRaw : handle;
  const theme = getTheme(
    pickStr(stage.themeId, data.themeId, profile.themeId) || "midnight_teal",
  );
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

  const bio = pickStr(data.bio, profile.bio);
  // Never fabricate welcome bios.
  const cleanBio = /welcome to .+['']s profile/i.test(bio) ? "" : bio;

  return {
    userId,
    username: handle,
    displayName,
    bio: cleanBio,
    pronouns: pickStr(data.pronouns, profile.pronouns),
    location: pickStr(
      data.location,
      data.city,
      data.country,
      profile.location,
      profile.country,
    ),
    photoURL:
      pickStr(
        data.photoURL,
        data.avatar,
        profile.photoURL,
        profile.avatar,
      ) || null,
    verified: data.verified === true || data.isVerified === true,
    vibe: pickStr(stage.vibe, data.vibe),
    coverUrl:
      pickStr(
        stage.coverUrl,
        data.coverUrl,
        data.bannerUrl,
        data.headerImage,
        profile.coverUrl,
        profile.bannerUrl,
      ) || null,
    theme,
    links: links.slice(0, 5),
    topCircle: (Array.isArray(stage.topCircle) ? stage.topCircle : [])
      .map((id) => String(id || "").trim())
      .filter(Boolean)
      .slice(0, 8),
    pinnedPostIds: (
      Array.isArray(stage.pinnedPostIds) ? stage.pinnedPostIds : []
    )
      .map((id) => String(id || "").trim())
      .filter(Boolean)
      .slice(0, 3),
    liveStreamId:
      String(data.status || "").toLowerCase() === "live"
        ? pickStr(data.streamId, data.liveStreamId) || null
        : null,
    flair: normalizeFlair({ ...profile, ...data }),
    stats: {
      posts: 0,
      followers: 0,
      following: 0,
      likes:
        Math.max(
          Number(data.likesCount) || 0,
          Number(data.totalLikes) || 0,
          Number(data.likeCount) || 0,
          Number(profile.likesCount) || 0,
          Number(profile.totalLikes) || 0,
        ) || 0,
    },
  };
}

export async function resolveUsernameToUid(
  username: string,
): Promise<string | null> {
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
    const value =
      field === "usernameKey" ? key : username.replace(/^@/, "").trim();
    try {
      const snap = await getDocs(
        query(collection(db, "users"), where(field, "==", value), limit(1)),
      );
      if (!snap.empty) return snap.docs[0]!.id;
    } catch {
      /* index may be missing for some fields */
    }
  }

  // Case-insensitive usernameKey retry with original casing variants
  try {
    const snap = await getDocs(
      query(
        collection(db, "users"),
        where("username", "==", username.replace(/^@/, "").trim()),
        limit(1),
      ),
    );
    if (!snap.empty) return snap.docs[0]!.id;
  } catch {
    /* ignore */
  }

  // Last resort: treat path segment as uid
  const byId = await getDoc(doc(db, "users", username.replace(/^@/, "").trim()));
  if (byId.exists()) return byId.id;
  return null;
}

async function fetchPastLives(userId: string): Promise<PastLiveItem[]> {
  const db = getDb();
  try {
    const snap = await getDocs(
      query(
        collection(db, "liveStreams"),
        where("userId", "==", userId),
        limit(50),
      ),
    );
    return snap.docs
      .map((d) => {
        const data = d.data() as Record<string, unknown>;
        const title =
          pickStr(
            data.title,
            data.streamTitle,
            data.liveTitle,
            data.name,
            data.caption,
          ) || "Live stream";
        return {
          id: d.id,
          status: String(data.status || ""),
          title,
          thumbnailUrl:
            pickStr(
              data.thumbnailUrl,
              data.thumbnail,
              data.coverUrl,
              data.posterUrl,
              data.hostPhotoURL,
              data.photoURL,
            ) || null,
          peakViewerCount:
            Number(data.peakViewerCount) || Number(data.totalViews) || 0,
          likes: Number(data.likes) || 0,
          endedAtMs:
            pastLiveToMillis(data.endedAt) ?? pastLiveToMillis(data.createdAt),
        };
      })
      .filter((r) => r.status.toLowerCase() !== "live")
      .sort((a, b) => (b.endedAtMs || 0) - (a.endedAtMs || 0))
      .slice(0, 12)
      .map((row) => ({
        id: row.id,
        title: row.title,
        thumbnailUrl: row.thumbnailUrl,
        peakViewerCount: row.peakViewerCount,
        likes: row.likes,
        endedAtMs: row.endedAtMs,
      }));
  } catch {
    return [];
  }
}

export async function fetchStageByUsername(
  username: string,
): Promise<StagePayload | null> {
  const uid = await resolveUsernameToUid(username);
  if (!uid) return null;
  const db = getDb();
  const [userSnap, profileSnap, posts, followers, following, pastLives] =
    await Promise.all([
      getDoc(doc(db, "users", uid)),
      getDoc(doc(db, "userProfiles", uid)),
      fetchPostsByUserId(uid, 48),
      getFollowersCount(uid),
      getFollowingCount(uid),
      fetchPastLives(uid),
    ]);
  const data = userSnap.exists()
    ? (userSnap.data() as Record<string, unknown>)
    : {};
  const profile = profileSnap.exists()
    ? (profileSnap.data() as Record<string, unknown>)
    : {};
  const stage = normalizeStage(uid, data, profile);

  let circleIds = stage.topCircle;
  if (!circleIds.length) {
    // Product lock: Top Circle = people you follow (curated later; following for now).
    try {
      const followingIds = await getFollowingIds(uid);
      circleIds = followingIds.slice(0, 8);
      stage.topCircle = circleIds;
    } catch {
      circleIds = [];
    }
  }

  const likesFromPosts = posts.reduce((sum, p) => sum + (p.likes || 0), 0);
  stage.stats = {
    posts: posts.length,
    followers,
    following,
    likes: Math.max(stage.stats.likes, likesFromPosts),
  };

  const [pinned, topCircle] = await Promise.all([
    Promise.all(stage.pinnedPostIds.map((id) => fetchPostById(id))).then(
      (rows) => rows.filter(Boolean) as FeedPost[],
    ),
    hydrateProfiles(circleIds),
  ]);

  // Preserve circle order
  const byId = new Map(topCircle.map((p) => [p.userId, p]));
  const orderedCircle = circleIds
    .map((id) => byId.get(id))
    .filter(Boolean) as SocialProfile[];

  return {
    stage,
    pinned,
    posts,
    topCircle: orderedCircle,
    pastLives,
  };
}
