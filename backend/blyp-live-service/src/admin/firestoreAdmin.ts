import { getApps, getApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore, FieldValue, type Firestore, type Query } from 'firebase-admin/firestore';
import { logger } from '../config/logger';

const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || 'blyp-master';

let app: App | null = null;
let firestore: Firestore | null = null;
let initFailed = false;

// blyp-live-service runs on Cloud Run in the SAME GCP project as Firestore
// (blyp-master), so Application Default Credentials authenticate Firestore reads
// with no key file. Initialization is lazy and failures degrade gracefully.
function getAppInstance(): App | null {
  if (app) return app;
  if (initFailed) return null;
  try {
    app = getApps().length ? getApp() : initializeApp({ projectId: FIREBASE_PROJECT_ID });
    return app;
  } catch (e: any) {
    initFailed = true;
    logger.error({ err: e?.message || String(e) }, '[firestore-admin] init failed');
    return null;
  }
}

export function getFirestore(): Firestore | null {
  if (firestore) return firestore;
  const a = getAppInstance();
  if (!a) return null;
  try {
    firestore = getAdminFirestore(a);
    return firestore;
  } catch (e: any) {
    logger.error({ err: e?.message || String(e) }, '[firestore-admin] firestore() failed');
    return null;
  }
}

export function isFirestoreAvailable(): boolean {
  return getFirestore() !== null;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function str(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  return String(value);
}

function tsToIso(value: any): string | null {
  if (!value) return null;
  try {
    if (typeof value.toDate === 'function') return value.toDate().toISOString();
    if (typeof value === 'object' && typeof value._seconds === 'number') {
      return new Date(value._seconds * 1000).toISOString();
    }
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  } catch {
    // ignore
  }
  return null;
}

export type FsPost = {
  postId: string;
  userId: string;
  authorUsername: string;
  authorDisplayName: string;
  content: string;
  postType: string;
  mediaUrl: string | null;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  likes: number;
  views: number;
  comments: number;
  createdAt: string | null;
};

function mapPost(id: string, data: Record<string, any>): FsPost {
  const media = Array.isArray(data.media) ? data.media : [];
  const firstMediaUrl = media.find((m: any) => m && (m.url || m.uri))?.url || media[0]?.uri || null;
  return {
    postId: id,
    userId: str(data.userId || data.uid || data.authorId),
    authorUsername: str(data.username || data.user?.username),
    authorDisplayName: str(data.username || data.user?.username),
    content: str(data.caption || data.title || data.description || data.transcript),
    postType: str(data.type) || 'post',
    mediaUrl: str(data.imageUrl) || firstMediaUrl || null,
    videoUrl: str(data.videoUrl) || null,
    thumbnailUrl: str(data.thumbnail || data.thumbnailUrl) || str(data.imageUrl) || firstMediaUrl || null,
    likes: num(data.likeCount ?? data.likes),
    views: num(data.viewCount ?? data.views),
    comments: num(data.commentCount ?? data.comments),
    createdAt: tsToIso(data.date || data.createdAt),
  };
}

const POSTS_WINDOW = 600;

// Posts are not range-queryable by text/offset in Firestore cheaply, so we read a
// bounded recent window ordered by date and filter/paginate in memory. Adequate for
// the current corpus; revisit with a search index if volume grows.
export async function listFirestorePostsWindow(): Promise<FsPost[] | null> {
  const fs = getFirestore();
  if (!fs) return null;
  try {
    let snap;
    try {
      snap = await fs.collection('posts').orderBy('date', 'desc').limit(POSTS_WINDOW).get();
    } catch {
      // Some docs may lack `date`; fall back to an unordered read.
      snap = await fs.collection('posts').limit(POSTS_WINDOW).get();
    }
    return snap.docs.map((d) => mapPost(d.id, d.data() || {}));
  } catch (e: any) {
    logger.error({ err: e?.message || String(e) }, '[firestore-admin] listFirestorePostsWindow failed');
    return null;
  }
}

export async function countFirestoreCollection(name: string): Promise<number | null> {
  const fs = getFirestore();
  if (!fs) return null;
  try {
    const snap = await fs.collection(name).count().get();
    return Number(snap.data().count || 0);
  } catch (e: any) {
    logger.error({ err: e?.message || String(e), name }, '[firestore-admin] countFirestoreCollection failed');
    return null;
  }
}

export async function listFirestoreUserPosts(userId: string): Promise<FsPost[] | null> {
  const fs = getFirestore();
  if (!fs) return null;
  try {
    const snap = await fs.collection('posts').where('userId', '==', userId).limit(500).get();
    const posts = snap.docs.map((d) => mapPost(d.id, d.data() || {}));
    posts.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    return posts;
  } catch (e: any) {
    logger.error({ err: e?.message || String(e) }, '[firestore-admin] listFirestoreUserPosts failed');
    return null;
  }
}

export type FsStream = {
  streamId: string;
  userId: string;
  hostDisplayName: string;
  hostUsername: string;
  title: string;
  status: string;
  viewerCount: number;
  peakViewerCount: number;
  totalViews: number;
  likes: number;
  thumbnailUrl: string | null;
  createdAt: string | null;
  lastHeartbeatAt: string | null;
};

function mapStream(id: string, data: Record<string, any>): FsStream {
  return {
    streamId: str(data.streamId) || id,
    userId: str(data.userId || data.hostUid),
    hostDisplayName: str(data.hostDisplayName),
    hostUsername: str(data.hostUsername),
    title: str(data.title),
    status: str(data.status) || 'unknown',
    viewerCount: num(data.viewerCount),
    peakViewerCount: num(data.peakViewerCount),
    totalViews: num(data.totalViews),
    likes: num(data.likes),
    thumbnailUrl: str(data.thumbnailUrl) || null,
    createdAt: tsToIso(data.createdAt),
    lastHeartbeatAt: tsToIso(data.lastHeartbeatAt),
  };
}

/**
 * Sync an admin role change onto the canonical Firestore user doc that the mobile
 * app reads for in-app admin powers (`useIsAdmin` checks `users/{uid}.roles[]` /
 * `isAdmin`). The Firebase custom token mints `uid == Cognito sub`, and Firestore
 * `users/{uid}` is keyed by that same sub, so the admin `userId` (Cognito sub) is
 * the exact Firestore doc id. Without this, toggling a role only updated the
 * Postgres `user_admin_state.role` (used for the admin console display) and had no
 * effect on the actual app — which is why "make Melody an admin" appeared to do
 * nothing.
 *
 * Returns the outcome so callers can log/audit it. Never throws — a Firestore
 * outage must not block the Postgres write.
 */
export async function syncUserRoleToFirestore(
  userId: string,
  role: string,
  opts?: { email?: string | null }
): Promise<{ ok: boolean; matchedDocs: number; detail?: string }> {
  const fs = getFirestore();
  if (!fs) return { ok: false, matchedDocs: 0, detail: 'firestore_unavailable' };

  const id = String(userId || '').trim();
  const isAdminRole = role === 'admin' || role === 'manager';
  const adminFields = isAdminRole
    ? { roles: FieldValue.arrayUnion('admin'), isAdmin: true, adminRoleUpdatedAt: FieldValue.serverTimestamp() }
    : { roles: FieldValue.arrayRemove('admin'), isAdmin: false, adminRoleUpdatedAt: FieldValue.serverTimestamp() };

  let matchedDocs = 0;
  try {
    // Primary: the doc id equals the Cognito sub (and Firebase uid).
    if (id) {
      const ref = fs.collection('users').doc(id);
      const snap = await ref.get();
      if (snap.exists) {
        await ref.set(adminFields, { merge: true });
        matchedDocs += 1;
      }
    }

    // Fallback: if no direct-id doc exists, resolve by email. Covers any user
    // whose Firestore doc id diverges from the Cognito sub.
    if (matchedDocs === 0 && opts?.email) {
      const email = String(opts.email).trim().toLowerCase();
      if (email) {
        const byEmail = await fs.collection('users').where('email', '==', email).limit(5).get();
        for (const d of byEmail.docs) {
          await d.ref.set(adminFields, { merge: true });
          matchedDocs += 1;
        }
      }
    }

    return { ok: true, matchedDocs };
  } catch (e: any) {
    logger.error({ err: e?.message || String(e), userId: id }, '[firestore-admin] syncUserRoleToFirestore failed');
    return { ok: false, matchedDocs, detail: e?.message || String(e) };
  }
}

/**
 * Resolve the team (and its leader) that a user belongs to, for paying out team
 * gift bonuses. Teams live in Firestore; `teams/{id}.memberIds` is an array of
 * member uids and `leaderId` is the owner. Single-team assumption (returns the
 * first match). Returns null if the user is not in a team.
 */
export async function getUserTeamForEarnings(
  userId: string
): Promise<{ teamId: string; leaderId: string } | null> {
  const fs = getFirestore();
  if (!fs) return null;
  const uid = String(userId || '').trim();
  if (!uid) return null;
  try {
    const snap = await fs
      .collection('teams')
      .where('memberIds', 'array-contains', uid)
      .limit(1)
      .get();
    if (snap.empty) return null;
    const d = snap.docs[0];
    const data = d.data() || {};
    const leaderId = str(data.leaderId);
    return { teamId: d.id, leaderId };
  } catch (e: any) {
    logger.error({ err: e?.message || String(e), userId: uid }, '[firestore-admin] getUserTeamForEarnings failed');
    return null;
  }
}

/**
 * Mirror team gift-earning aggregates into Firestore so the leader dashboard can
 * read them live. Stores PRECISE (possibly fractional) bonus figures for display
 * — the wallet itself only holds whole gems, but the dashboard shows what each
 * member/leader has truly earned. Best-effort; never throws.
 */
export async function mirrorTeamEarnings(input: {
  teamId: string;
  memberUserId: string;
  memberDisplayName?: string | null;
  leaderUserId?: string | null;
  baseGemsDelta: number;
  memberBonusDelta: number;
  leaderBonusDelta: number;
  coinsDelta: number;
}): Promise<void> {
  const fs = getFirestore();
  if (!fs) return;
  const { teamId, memberUserId } = input;
  if (!teamId || !memberUserId) return;
  try {
    const memberRef = fs.collection('teams').doc(teamId).collection('members').doc(memberUserId);
    const memberUpdate: Record<string, any> = {
      gemsEarned: FieldValue.increment(input.baseGemsDelta || 0),
      teamBonusGems: FieldValue.increment(input.memberBonusDelta || 0),
      coinsReceived: FieldValue.increment(input.coinsDelta || 0),
      earningsUpdatedAt: FieldValue.serverTimestamp(),
    };
    if (input.memberDisplayName) memberUpdate.displayName = input.memberDisplayName;
    await memberRef.set(memberUpdate, { merge: true });

    const teamUpdate: Record<string, any> = {
      teamTotalGems: FieldValue.increment(input.baseGemsDelta || 0),
      teamBonusPaidGems: FieldValue.increment(input.memberBonusDelta || 0),
      earningsUpdatedAt: FieldValue.serverTimestamp(),
    };
    if (input.leaderBonusDelta) {
      teamUpdate.leaderBonusGems = FieldValue.increment(input.leaderBonusDelta);
    }
    await fs.collection('teams').doc(teamId).set(teamUpdate, { merge: true });
  } catch (e: any) {
    logger.error({ err: e?.message || String(e), teamId, memberUserId }, '[firestore-admin] mirrorTeamEarnings failed');
  }
}

export async function listFirestoreStreams(status?: 'live' | 'ended'): Promise<FsStream[] | null> {
  const fs = getFirestore();
  if (!fs) return null;
  try {
    let query: Query = fs.collection('liveStreams');
    if (status) query = query.where('status', '==', status);
    const snap = await query.limit(300).get();
    const streams = snap.docs.map((d) => mapStream(d.id, d.data() || {}));
    streams.sort((a, b) => {
      if (a.status === 'live' && b.status !== 'live') return -1;
      if (b.status === 'live' && a.status !== 'live') return 1;
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });
    return streams;
  } catch (e: any) {
    logger.error({ err: e?.message || String(e) }, '[firestore-admin] listFirestoreStreams failed');
    return null;
  }
}
