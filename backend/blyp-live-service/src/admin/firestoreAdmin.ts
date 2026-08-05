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

export type FsReport = {
  reportId: string;
  targetType: string;
  targetId: string;
  reporterId: string;
  reasonCode: string;
  details: string;
  status: string;
  surface: string | null;
  createdAt: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolveNote: string | null;
};

function mapReport(id: string, data: Record<string, any>): FsReport {
  return {
    reportId: id,
    targetType: str(data.targetType),
    targetId: str(data.targetId),
    reporterId: str(data.reporterId),
    reasonCode: str(data.reasonCode),
    details: str(data.details),
    status: str(data.status) || 'open',
    surface: str(data.surface) || null,
    createdAt: tsToIso(data.createdAt) || (typeof data.createdAt === 'number' ? new Date(data.createdAt).toISOString() : null),
    resolvedAt: tsToIso(data.resolvedAt),
    resolvedBy: str(data.resolvedBy) || null,
    resolveNote: str(data.resolveNote) || null,
  };
}

/**
 * List user-submitted reports from the Firestore `reports` collection
 * (written by mobile ReportingService). Admin SDK bypasses client rules.
 */
export async function listFirestoreReports(opts?: {
  status?: 'open' | 'resolved' | 'dismissed' | 'all';
  limit?: number;
}): Promise<{ available: boolean; reports: FsReport[]; detail?: string }> {
  const fs = getFirestore();
  if (!fs) return { available: false, reports: [], detail: 'firestore_unavailable' };

  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 100);
  const status = opts?.status || 'open';

  try {
    let query: Query = fs.collection('reports');
    if (status !== 'all') {
      query = query.where('status', '==', status);
    }
    // Prefer newest-first when createdAt is numeric (ReportingService uses Date.now()).
    // OrderBy may require a composite index for filtered status; fall back to unsorted.
    let snap;
    try {
      snap = await query.orderBy('createdAt', 'desc').limit(limit).get();
    } catch {
      snap = await query.limit(limit).get();
    }

    const reports = snap.docs.map((d) => mapReport(d.id, d.data() || {}));
    reports.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return { available: true, reports: reports.slice(0, limit) };
  } catch (e: any) {
    logger.error({ err: e?.message || String(e) }, '[firestore-admin] listFirestoreReports failed');
    return { available: false, reports: [], detail: e?.message || String(e) };
  }
}

export async function resolveFirestoreReport(input: {
  reportId: string;
  actorUserId: string;
  status: 'resolved' | 'dismissed';
  note?: string | null;
}): Promise<{ ok: boolean; report?: FsReport; detail?: string }> {
  const fs = getFirestore();
  if (!fs) return { ok: false, detail: 'firestore_unavailable' };

  const reportId = String(input.reportId || '').trim();
  if (!reportId) return { ok: false, detail: 'missing_report_id' };

  try {
    const ref = fs.collection('reports').doc(reportId);
    const snap = await ref.get();
    if (!snap.exists) return { ok: false, detail: 'not_found' };

    const patch = {
      status: input.status,
      resolvedAt: FieldValue.serverTimestamp(),
      resolvedBy: input.actorUserId,
      resolveNote: asStringSafe(input.note),
    };
    await ref.set(patch, { merge: true });
    const after = await ref.get();
    return { ok: true, report: mapReport(after.id, after.data() || {}) };
  } catch (e: any) {
    logger.error({ err: e?.message || String(e), reportId }, '[firestore-admin] resolveFirestoreReport failed');
    return { ok: false, detail: e?.message || String(e) };
  }
}

function asStringSafe(value: unknown): string {
  if (value == null) return '';
  return String(value).trim().slice(0, 500);
}

/** Extract profile photo URL from a Firestore users/{uid} document. */
function photoFromUserData(data: Record<string, unknown>): string | null {
  return (
    str(data.photoURL)
    || str(data.avatar)
    || str(data.profileImage)
    || str(data.profilePhoto)
    || null
  );
}

/** Account-wide For You / discovery weight (users/{uid}.feedPriorityAccount). */
export type AccountFeedPriority = 'suppress' | 'low' | 'standard' | 'high' | 'boost';

const ACCOUNT_FEED_PRIORITIES = new Set<AccountFeedPriority>([
  'suppress',
  'low',
  'standard',
  'high',
  'boost',
]);

export function normalizeAccountFeedPriority(raw: unknown): AccountFeedPriority {
  const v = String(raw || 'standard').trim().toLowerCase();
  if (v === 'less') return 'low';
  if (ACCOUNT_FEED_PRIORITIES.has(v as AccountFeedPriority)) return v as AccountFeedPriority;
  return 'standard';
}

/** Read display fields stored on the canonical Firestore user doc. */
export async function getFirestoreUserPublicFields(
  userId: string,
): Promise<{
  avatarFrame: string | null;
  photoURL: string | null;
  feedPriorityAccount: AccountFeedPriority;
}> {
  const fs = getFirestore();
  if (!fs) {
    return { avatarFrame: null, photoURL: null, feedPriorityAccount: 'standard' };
  }
  const id = String(userId || '').trim();
  if (!id) {
    return { avatarFrame: null, photoURL: null, feedPriorityAccount: 'standard' };
  }
  try {
    const snap = await fs.collection('users').doc(id).get();
    if (!snap.exists) {
      return { avatarFrame: null, photoURL: null, feedPriorityAccount: 'standard' };
    }
    const data = snap.data() || {};
    const frame = data.avatarFrame ? String(data.avatarFrame) : '';
    return {
      avatarFrame: frame || null,
      photoURL: photoFromUserData(data as Record<string, unknown>),
      feedPriorityAccount: normalizeAccountFeedPriority(
        data.feedPriorityAccount || data.creatorFeedWeight,
      ),
    };
  } catch {
    return { avatarFrame: null, photoURL: null, feedPriorityAccount: 'standard' };
  }
}

/** Batch-read profile photos for admin user lists (page-sized). */
export async function getFirestoreUserPhotosBatch(
  userIds: string[],
): Promise<Map<string, string | null>> {
  const fs = getFirestore();
  const out = new Map<string, string | null>();
  if (!fs) return out;

  const ids = [...new Set(userIds.map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) return out;

  try {
    for (let i = 0; i < ids.length; i += 30) {
      const chunk = ids.slice(i, i + 30);
      const refs = chunk.map((id) => fs.collection('users').doc(id));
      const snaps = await fs.getAll(...refs);
      for (const snap of snaps) {
        out.set(
          snap.id,
          snap.exists ? photoFromUserData((snap.data() || {}) as Record<string, unknown>) : null,
        );
      }
    }
    for (const id of ids) {
      if (!out.has(id)) out.set(id, null);
    }
  } catch (e: any) {
    logger.warn(
      { err: e?.message || String(e), count: ids.length },
      '[firestore-admin] getFirestoreUserPhotosBatch failed',
    );
  }
  return out;
}

/** Sync admin-granted avatar frame onto Firestore users/{uid} for in-app display. */
export async function syncAvatarFrameToFirestore(
  userId: string,
  avatarFrame: string | null,
  opts?: { email?: string | null }
): Promise<{ ok: boolean; matchedDocs: number; detail?: string }> {
  const fs = getFirestore();
  if (!fs) return { ok: false, matchedDocs: 0, detail: 'firestore_unavailable' };

  const id = String(userId || '').trim();
  const frame = avatarFrame ? String(avatarFrame).trim() : '';
  const fields = frame
    ? { avatarFrame: frame, avatarFrameUpdatedAt: FieldValue.serverTimestamp() }
    : { avatarFrame: FieldValue.delete(), avatarFrameUpdatedAt: FieldValue.serverTimestamp() };

  let matchedDocs = 0;
  try {
    if (id) {
      const ref = fs.collection('users').doc(id);
      await ref.set({ sub: id, ...fields }, { merge: true });
      matchedDocs += 1;
    }
    if (matchedDocs === 0 && opts?.email) {
      const email = String(opts.email).trim().toLowerCase();
      if (email) {
        const byEmail = await fs.collection('users').where('email', '==', email).limit(5).get();
        for (const d of byEmail.docs) {
          await d.ref.set(fields, { merge: true });
          matchedDocs += 1;
        }
      }
    }
    return { ok: true, matchedDocs };
  } catch (e: any) {
    logger.error({ err: e?.message || String(e), userId: id }, '[firestore-admin] syncAvatarFrameToFirestore failed');
    return { ok: false, matchedDocs, detail: e?.message || String(e) };
  }
}

/** Resolve HLS/IVS playback URL for mass viewers from Firestore stream docs. */
export async function getStreamPlaybackForViewer(
  sessionId: string,
): Promise<{ playbackUrl: string | null; status: string | null; directoryReady: boolean }> {
  const fs = getFirestore();
  if (!fs) return { playbackUrl: null, status: null, directoryReady: false };
  const id = String(sessionId || '').trim();
  if (!id) return { playbackUrl: null, status: null, directoryReady: false };

  const pickPlayback = (data: Record<string, unknown>) => {
    const hls = data.hls && typeof data.hls === 'object' ? (data.hls as Record<string, unknown>) : null;
    const url =
      data.playbackUrl ||
      data.hlsPlaybackUrl ||
      (hls && hls.playbackUrl) ||
      data.streamUrl ||
      data.playback_url ||
      '';
    return url ? String(url).trim() : null;
  };

  try {
    for (const coll of ['liveStreams', 'streams']) {
      const snap = await fs.collection(coll).doc(id).get();
      if (!snap.exists) continue;
      const data = snap.data() || {};
      return {
        playbackUrl: pickPlayback(data),
        status: data.status ? String(data.status) : null,
        directoryReady: data.directoryReady !== false,
      };
    }
    return { playbackUrl: null, status: null, directoryReady: false };
  } catch {
    return { playbackUrl: null, status: null, directoryReady: false };
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

export type FsTeam = {
  teamId: string;
  name: string;
  description: string;
  leaderId: string;
  leaderName: string;
  memberCount: number;
  createdAt: string | null;
};

export type FsTeamApplication = {
  uid: string;
  displayName: string;
  photoURL: string | null;
  pitch: string;
  status: string;
  createdAt: string | null;
};

function mapTeam(id: string, data: Record<string, any>): FsTeam {
  return {
    teamId: id,
    name: str(data.name) || 'Team',
    description: str(data.description),
    leaderId: str(data.leaderId),
    leaderName: str(data.leaderName),
    memberCount: num(data.memberCount),
    createdAt: tsToIso(data.createdAt),
  };
}

export async function listFirestoreTeams(limitN = 100): Promise<FsTeam[] | null> {
  const fs = getFirestore();
  if (!fs) return null;
  try {
    let snap;
    try {
      snap = await fs.collection('teams').orderBy('memberCount', 'desc').limit(limitN).get();
    } catch {
      snap = await fs.collection('teams').limit(limitN).get();
    }
    return snap.docs.map((d) => mapTeam(d.id, d.data() || {}));
  } catch (e: any) {
    logger.error({ err: e?.message || String(e) }, '[firestore-admin] listFirestoreTeams failed');
    return null;
  }
}

export async function listFirestoreTeamApplications(limitN = 100): Promise<FsTeamApplication[] | null> {
  const fs = getFirestore();
  if (!fs) return null;
  try {
    const snap = await fs.collection('teamApplications').limit(limitN).get();
    const items = snap.docs.map((d) => {
      const data = d.data() || {};
      return {
        uid: d.id,
        displayName: str(data.displayName),
        photoURL: str(data.photoURL) || null,
        pitch: str(data.pitch),
        status: str(data.status) || 'pending',
        createdAt: tsToIso(data.createdAt),
      };
    });
    items.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    return items;
  } catch (e: any) {
    logger.error({ err: e?.message || String(e) }, '[firestore-admin] listFirestoreTeamApplications failed');
    return null;
  }
}

export async function approveTeamApplication(
  applicantUid: string,
  opts: { teamName?: string; teamDesc?: string } = {},
): Promise<{ teamId: string } | null> {
  const fs = getFirestore();
  if (!fs || !applicantUid) return null;
  const uid = String(applicantUid).trim();
  try {
    const appRef = fs.collection('teamApplications').doc(uid);
    const appSnap = await appRef.get();
    if (!appSnap.exists) return null;
    const appData = appSnap.data() || {};

    const userSnap = await fs.collection('users').doc(uid).get();
    const userData = userSnap.exists ? userSnap.data() || {} : {};
    const leaderName = str(appData.displayName) || str(userData.displayName) || str(userData.username) || 'Leader';
    const leaderPhoto = str(userData.photoURL || userData.avatar || appData.photoURL) || null;
    const teamId = `team_${uid}`;
    const teamRef = fs.collection('teams').doc(teamId);
    const now = FieldValue.serverTimestamp();
    const teamName = str(opts.teamName) || `${leaderName}'s Team`;
    const teamDesc = str(opts.teamDesc) || str(appData.pitch) || 'Official Blyp creator team.';

    await teamRef.set(
      {
        name: teamName,
        description: teamDesc,
        leaderId: uid,
        leaderName,
        leaderPhoto,
        memberCount: 1,
        memberIds: FieldValue.arrayUnion(uid),
        createdAt: now,
        updatedAt: now,
      },
      { merge: true },
    );

    await teamRef.collection('members').doc(uid).set(
      {
        uid,
        displayName: leaderName,
        photoURL: leaderPhoto,
        role: 'leader',
        hoursLive: 0,
        joinedAt: now,
      },
      { merge: true },
    );

    await appRef.set(
      {
        status: 'approved',
        teamId,
        reviewedAt: now,
        updatedAt: now,
      },
      { merge: true },
    );

    return { teamId };
  } catch (e: any) {
    logger.error({ err: e?.message || String(e), applicantUid }, '[firestore-admin] approveTeamApplication failed');
    return null;
  }
}

export async function rejectTeamApplication(applicantUid: string, reason = ''): Promise<boolean> {
  const fs = getFirestore();
  if (!fs || !applicantUid) return false;
  try {
    await fs.collection('teamApplications').doc(String(applicantUid).trim()).set(
      {
        status: 'rejected',
        rejectReason: String(reason || '').slice(0, 500),
        reviewedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return true;
  } catch (e: any) {
    logger.error({ err: e?.message || String(e) }, '[firestore-admin] rejectTeamApplication failed');
    return false;
  }
}

/**
 * Mirror post/feed gift totals onto the Firestore post doc so the For You
 * feed can show coins gifted (likes-style). Best-effort; never throws to callers.
 */
export async function incrementPostGiftTotals(
  postId: string,
  coinSpent: number,
  giftCountDelta = 1,
): Promise<boolean> {
  const fs = getFirestore();
  const id = String(postId || '').trim();
  const coins = Math.max(0, Math.floor(Number(coinSpent) || 0));
  const count = Math.max(0, Math.floor(Number(giftCountDelta) || 0));
  if (!fs || !id || (coins <= 0 && count <= 0)) return false;
  try {
    await fs.collection('posts').doc(id).set(
      {
        giftCoins: FieldValue.increment(coins),
        giftCount: FieldValue.increment(count),
        coinsReceived: FieldValue.increment(coins),
        giftUpdatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return true;
  } catch (e: any) {
    logger.error(
      { err: e?.message || String(e), postId: id, coins },
      '[firestore-admin] incrementPostGiftTotals failed',
    );
    return false;
  }
}

/**
 * Per-post For You priority.
 * Canonical 5: suppress | low | standard | high | boost.
 * Legacy `less` is accepted by the API and normalized to `low` on write.
 */
export type FeedPriority = 'suppress' | 'low' | 'standard' | 'high' | 'boost';

export function normalizePostFeedPriority(raw: unknown): FeedPriority {
  const v = String(raw || 'standard').trim().toLowerCase();
  if (v === 'less') return 'low';
  if (v === 'suppress' || v === 'low' || v === 'standard' || v === 'high' || v === 'boost') {
    return v;
  }
  return 'standard';
}

export async function setPostFeedPriorityFs(
  postId: string,
  priority: FeedPriority | 'less',
  actorUserId?: string | null,
): Promise<{ ok: boolean; detail?: string }> {
  const fs = getFirestore();
  const id = String(postId || '').trim();
  const normalized = normalizePostFeedPriority(priority);
  if (!fs) return { ok: false, detail: 'firestore_unavailable' };
  if (!id) return { ok: false, detail: 'missing_post_id' };
  try {
    const payload: Record<string, unknown> = {
      feedPriority: normalized,
      feedPriorityUpdatedAt: FieldValue.serverTimestamp(),
    };
    if (actorUserId) payload.feedPriorityUpdatedBy = String(actorUserId);
    await fs.collection('posts').doc(id).set(payload, { merge: true });
    return { ok: true };
  } catch (e: any) {
    const detail = e?.message || String(e);
    logger.error(
      { err: detail, postId: id, priority: normalized },
      '[firestore-admin] setPostFeedPriorityFs failed',
    );
    return { ok: false, detail };
  }
}

/** Account-wide feed weight on users/{uid} — read by For You / discovery. */
export async function setUserFeedPriorityFs(
  userId: string,
  priority: AccountFeedPriority,
  actorUserId?: string | null,
): Promise<{ ok: boolean; detail?: string }> {
  const fs = getFirestore();
  const id = String(userId || '').trim();
  const normalized = normalizeAccountFeedPriority(priority);
  if (!fs) return { ok: false, detail: 'firestore_unavailable' };
  if (!id) return { ok: false, detail: 'missing_user_id' };
  try {
    const payload: Record<string, unknown> = {
      feedPriorityAccount: normalized,
      feedPriorityAccountUpdatedAt: FieldValue.serverTimestamp(),
    };
    if (actorUserId) payload.feedPriorityAccountUpdatedBy = String(actorUserId);
    await fs.collection('users').doc(id).set({ sub: id, ...payload }, { merge: true });
    return { ok: true };
  } catch (e: any) {
    const detail = e?.message || String(e);
    logger.error(
      { err: detail, userId: id, priority: normalized },
      '[firestore-admin] setUserFeedPriorityFs failed',
    );
    return { ok: false, detail };
  }
}

/**
 * Soft-hide / unhide a post for all mobile feeds (`filterBlocked` drops
 * `moderation.hidden === true`). Complements Postgres `post_admin_state`.
 */
export async function setPostModerationHiddenFs(
  postId: string,
  hidden: boolean,
  reason?: string | null,
  actorUserId?: string | null,
): Promise<{ ok: boolean; detail?: string }> {
  const fs = getFirestore();
  const id = String(postId || '').trim();
  if (!fs) return { ok: false, detail: 'firestore_unavailable' };
  if (!id) return { ok: false, detail: 'missing_post_id' };
  try {
    const moderation: Record<string, unknown> = {
      hidden: hidden === true,
      hiddenAt: hidden ? FieldValue.serverTimestamp() : null,
      hiddenReason: hidden ? String(reason || '').trim() || null : null,
      hiddenBy: hidden && actorUserId ? String(actorUserId) : null,
    };
    await fs.collection('posts').doc(id).set({ moderation }, { merge: true });
    return { ok: true };
  } catch (e: any) {
    const detail = e?.message || String(e);
    logger.error(
      { err: detail, postId: id, hidden },
      '[firestore-admin] setPostModerationHiddenFs failed',
    );
    return { ok: false, detail };
  }
}

/**
 * Queue a durable FCM/in-app notification for a host-initiated guest invite.
 * Matches the Cloud Functions outbox shape so notificationDispatch can send it.
 */
export async function enqueueGuestInviteNotification(input: {
  guestUserId: string;
  hostUserId: string;
  sessionId: string;
  hostDisplayName?: string;
}): Promise<{ ok: boolean; detail?: string }> {
  const fs = getFirestore();
  const guestUserId = String(input.guestUserId || '').trim();
  const hostUserId = String(input.hostUserId || '').trim();
  const sessionId = String(input.sessionId || '').trim();
  if (!fs) return { ok: false, detail: 'firestore_unavailable' };
  if (!guestUserId || !hostUserId || !sessionId) return { ok: false, detail: 'missing_fields' };

  let hostName = String(input.hostDisplayName || '').trim();
  if (!hostName) {
    try {
      const snap = await fs.collection('users').doc(hostUserId).get();
      const d = (snap.data() || {}) as Record<string, unknown>;
      hostName = String(d.displayName || d.username || d.name || '').trim();
    } catch {
      /* ignore */
    }
  }
  if (!hostName) hostName = 'A host';

  const crypto = await import('crypto');
  const dedupeKey = `guestinvite:${sessionId}:${guestUserId}`;
  const id = 'n_' + crypto.createHash('sha1').update(dedupeKey).digest('hex').slice(0, 32);
  const now = Date.now();
  const doc = {
    userId: guestUserId,
    type: 'live',
    title: 'Join the live',
    body: `${hostName} invited you on stage`,
    data: {
      type: 'guest_invite',
      streamId: sessionId,
      hostId: hostUserId,
      screen: 'LiveStream',
    },
    dedupeKey,
    collapseKey: `guestinvite:${sessionId}`,
    status: 'queued',
    sendAfter: now,
    attempts: 0,
    maxAttempts: 5,
    nextAttemptAt: 0,
    createdAt: now,
  };

  try {
    await fs.collection('notifications').doc(id).create(doc);
    return { ok: true };
  } catch (e: any) {
    const code = e?.code || e?.status;
    if (code === 6 || code === 'already-exists' || /already exists/i.test(String(e?.message || ''))) {
      return { ok: true, detail: 'already_queued' };
    }
    const detail = e?.message || String(e);
    logger.error(
      { err: detail, guestUserId, sessionId },
      '[firestore-admin] enqueueGuestInviteNotification failed',
    );
    return { ok: false, detail };
  }
}
