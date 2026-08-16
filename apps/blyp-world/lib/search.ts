import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
} from "firebase/firestore";
import { getDb } from "./firebase";

export type SearchUser = {
  id: string;
  username: string;
  displayName: string;
  photoURL: string | null;
};

export type SearchPost = {
  id: string;
  username: string;
  caption: string;
  posterUrl: string | null;
  likes: number;
};

export type SearchTeam = {
  id: string;
  name: string;
  memberCount: number;
  leaderName: string;
};

export type SearchResults = {
  users: SearchUser[];
  posts: SearchPost[];
  teams: SearchTeam[];
};

function pickStr(...vals: unknown[]): string {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function scoreUser(q: string, username: string, display: string): number {
  if (username && username === q) return 100;
  if (display && display === q) return 95;
  if (username && username.startsWith(q)) return 80;
  if (display && display.startsWith(q)) return 70;
  if (username && username.includes(q)) return 50;
  if (display && display.includes(q)) return 45;
  if (display) {
    const first = display.split(/\s+/)[0] || "";
    if (first && (first === q || q.startsWith(first) || first.startsWith(q))) {
      return 40;
    }
  }
  return 0;
}

/** Same shape as mobile `findUsersByName` — scan recent users, score locally. */
export async function searchUsers(
  term: string,
  limitCount = 12,
): Promise<SearchUser[]> {
  const q = String(term || "")
    .replace(/^@/, "")
    .trim()
    .toLowerCase();
  if (q.length < 1) return [];

  const db = getDb();
  const snap = await getDocs(query(collection(db, "users"), limit(300)));
  const scored: { score: number; user: SearchUser }[] = [];

  for (const d of snap.docs) {
    const data = d.data() as Record<string, unknown>;
    const username = pickStr(data.username, data.handle).replace(/^@/, "");
    const display = pickStr(data.displayName, data.name, username);
    const score = scoreUser(q, username.toLowerCase(), display.toLowerCase());
    if (score <= 0) continue;
    scored.push({
      score,
      user: {
        id: d.id,
        username: username || d.id.slice(0, 8),
        displayName: display || username || "User",
        photoURL:
          pickStr(
            data.photoURL,
            data.avatar,
            data.userPhotoURL,
            data.photo,
          ) || null,
      },
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limitCount).map((s) => s.user);
}

/** Same as mobile `searchPosts` — recent posts, caption/tag match. */
export async function searchPosts(
  term: string,
  limitCount = 20,
): Promise<SearchPost[]> {
  const q = String(term || "")
    .trim()
    .toLowerCase();
  if (q.length < 2) return [];

  const db = getDb();
  let snap;
  try {
    snap = await getDocs(
      query(collection(db, "posts"), orderBy("date", "desc"), limit(120)),
    );
  } catch {
    snap = await getDocs(query(collection(db, "posts"), limit(120)));
  }

  const matched: SearchPost[] = [];
  for (const d of snap.docs) {
    const data = d.data() as Record<string, unknown>;
    if (data.isRemoved === true || data.hidden === true) continue;
    const hashtags = Array.isArray(data.hashtags) ? data.hashtags : [];
    const tags = Array.isArray(data.tags) ? data.tags : [];
    const hay = [
      data.caption,
      data.description,
      data.transcript,
      data.title,
      ...hashtags,
      ...tags,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!hay.includes(q)) continue;

    const media = Array.isArray(data.media) ? data.media : [];
    const first = media[0] as Record<string, unknown> | undefined;
    matched.push({
      id: d.id,
      username:
        pickStr(
          data.username,
          (data.user as Record<string, unknown> | undefined)?.username,
        ) || "user",
      caption: pickStr(data.caption, data.description, data.transcript) || "",
      posterUrl:
        pickStr(
          data.thumbnailUrl,
          data.thumbUrl,
          data.posterUrl,
          first?.thumbnailUrl,
          first?.thumbUrl,
        ) || null,
      likes: Number(data.likeCount ?? data.likes ?? 0) || 0,
    });
    if (matched.length >= limitCount) break;
  }
  return matched;
}

/** Best-effort team name match from the teams collection. */
export async function searchTeams(
  term: string,
  limitCount = 8,
): Promise<SearchTeam[]> {
  const q = String(term || "")
    .trim()
    .toLowerCase();
  if (q.length < 2) return [];

  const db = getDb();
  const snap = await getDocs(query(collection(db, "teams"), limit(150)));
  const out: SearchTeam[] = [];
  for (const d of snap.docs) {
    const data = d.data() as Record<string, unknown>;
    if (String(data.status || "active") === "closed") continue;
    const name = pickStr(data.name, data.teamName);
    if (!name.toLowerCase().includes(q)) continue;
    out.push({
      id: d.id,
      name,
      memberCount: Number(data.memberCount) || 0,
      leaderName: pickStr(data.leaderName, data.leaderUsername) || "Leader",
    });
    if (out.length >= limitCount) break;
  }
  return out;
}

export async function runSearch(term: string): Promise<SearchResults> {
  const q = String(term || "").trim();
  if (q.length < 2) {
    return { users: [], posts: [], teams: [] };
  }
  const [users, posts, teams] = await Promise.all([
    searchUsers(q, 12),
    searchPosts(q, 20),
    searchTeams(q, 8).catch(() => [] as SearchTeam[]),
  ]);
  return { users, posts, teams };
}
