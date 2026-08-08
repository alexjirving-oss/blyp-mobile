import { getApps, getApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore, FieldValue, type Firestore, type Query, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { logger } from '../config/logger';
import { safeLiveDisplayName } from '../live/liveDisplayName';
import {
  buildPostGiftNotification,
  isPostGiftPushEnabled,
  pickPostGiftSenderName,
  postGiftBlockReason,
} from '../economy/postGiftNotification';

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
  isHidden?: boolean;
};

function mapPost(id: string, data: Record<string, any>): FsPost {
  const media = Array.isArray(data.media) ? data.media : [];
  const firstMediaUrl = media.find((m: any) => m && (m.url || m.uri))?.url || media[0]?.uri || null;
  const moderation = data.moderation && typeof data.moderation === 'object' ? data.moderation : null;
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
    isHidden: moderation?.hidden === true,
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
  reasonCode?: string;
}): Promise<{ available: boolean; reports: FsReport[]; detail?: string }> {
  const fs = getFirestore();
  if (!fs) return { available: false, reports: [], detail: 'firestore_unavailable' };

  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 100);
  const status = opts?.status || 'open';
  const reasonCode = String(opts?.reasonCode || '').trim().toLowerCase();
  const fetchLimit = reasonCode ? Math.min(100, Math.max(limit * 3, limit)) : limit;

  try {
    let query: Query = fs.collection('reports');
    if (status !== 'all') {
      query = query.where('status', '==', status);
    }
    // Prefer newest-first when createdAt is numeric (ReportingService uses Date.now()).
    // OrderBy may require a composite index for filtered status; fall back to unsorted.
    let snap;
    try {
      snap = await query.orderBy('createdAt', 'desc').limit(fetchLimit).get();
    } catch {
      snap = await query.limit(fetchLimit).get();
    }

    let reports = snap.docs.map((d) => mapReport(d.id, d.data() || {}));
    reports.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

    if (reasonCode) {
      reports = reports.filter((r) => String(r.reasonCode || '').trim().toLowerCase() === reasonCode);
    }

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

/** Single liveStreams doc by id (streamId / sessionId). */
export async function getFirestoreStream(streamId: string): Promise<FsStream | null> {
  const fs = getFirestore();
  const id = String(streamId || '').trim();
  if (!fs || !id) return null;
  try {
    const snap = await fs.collection('liveStreams').doc(id).get();
    if (!snap.exists) {
      // Some writers use streamId as a field with a different doc id — fall back to query.
      try {
        const q = await fs.collection('liveStreams').where('streamId', '==', id).limit(1).get();
        if (!q.empty) {
          const d = q.docs[0];
          return mapStream(d.id, d.data() || {});
        }
      } catch {
        /* ignore */
      }
      return null;
    }
    return mapStream(snap.id, snap.data() || {});
  } catch (e: any) {
    logger.error({ err: e?.message || String(e), streamId: id }, '[firestore-admin] getFirestoreStream failed');
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
  const leaderId = str(data.leaderId);
  const leaderName =
    safeLiveDisplayName(data.leaderDisplayName, leaderId, '') ||
    safeLiveDisplayName(data.leaderName, leaderId, '') ||
    safeLiveDisplayName(data.leaderUsername, leaderId, '') ||
    'Team owner';
  const storedName = str(data.name);
  const nameContainsInternalId =
    !storedName ||
    (!!leaderId && storedName.includes(leaderId)) ||
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
      .test(storedName) ||
    /^blyp[_-]\d+/i.test(storedName);
  return {
    teamId: id,
    name: nameContainsInternalId ? `${leaderName}'s Team` : storedName,
    description: str(data.description),
    leaderId,
    leaderName,
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

    const [userSnap, legacyProfileSnap] = await Promise.all([
      fs.collection('users').doc(uid).get(),
      fs.collection('userProfiles').doc(uid).get(),
    ]);
    const userData = userSnap.exists ? userSnap.data() || {} : {};
    const legacyProfile = legacyProfileSnap.exists ? legacyProfileSnap.data() || {} : {};
    const firstPublicLabel = (values: unknown[], fallback = ''): string => {
      for (const value of values) {
        const label = safeLiveDisplayName(value, uid, '');
        if (label) return label;
      }
      return fallback;
    };
    const leaderDisplayName = firstPublicLabel([
      userData.displayName,
      legacyProfile.displayName,
      userData.name,
      legacyProfile.name,
      appData.displayName,
    ]);
    const leaderUsername = firstPublicLabel([
      appData.username,
      userData.username,
      userData.handle,
      legacyProfile.username,
      legacyProfile.handle,
    ]);
    const leaderName = leaderDisplayName || leaderUsername || 'Leader';
    const leaderPhoto =
      str(
        userData.photoURL ||
        userData.avatar ||
        legacyProfile.photoURL ||
        legacyProfile.avatar ||
        appData.photoURL
      ) || null;
    const teamId = `team_${uid}`;
    const teamRef = fs.collection('teams').doc(teamId);
    const now = FieldValue.serverTimestamp();
    const requestedTeamName = str(opts.teamName);
    const requestedNameContainsInternalId =
      !!requestedTeamName &&
      (
        requestedTeamName.includes(uid) ||
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
          .test(requestedTeamName) ||
        /^blyp[_-]\d+/i.test(requestedTeamName)
      );
    const teamName =
      requestedTeamName && !requestedNameContainsInternalId
        ? requestedTeamName
        : `${leaderName}'s Team`;
    const teamDesc = str(opts.teamDesc) || str(appData.pitch) || 'Official Blyp creator team.';

    await teamRef.set(
      {
        name: teamName,
        description: teamDesc,
        leaderId: uid,
        leaderName,
        leaderDisplayName: leaderName,
        leaderUsername,
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
        username: leaderUsername,
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

export async function setPostReachBoostedFs(
  postId: string,
  boosted: boolean,
  opts?: { boostEndsAt?: string | null; boostPromotionId?: string | null; actorUserId?: string | null },
): Promise<{ ok: boolean; detail?: string }> {
  const fs = getFirestore();
  const id = String(postId || '').trim();
  if (!fs) return { ok: false, detail: 'firestore_unavailable' };
  if (!id) return { ok: false, detail: 'missing_post_id' };
  try {
    const reach: Record<string, unknown> = {
      boosted: Boolean(boosted),
    };
    if (opts?.boostEndsAt != null) reach.boostEndsAt = opts.boostEndsAt;
    if (opts?.boostPromotionId != null) reach.boostPromotionId = opts.boostPromotionId;
    const payload: Record<string, unknown> = {
      reach,
      reachBoostUpdatedAt: FieldValue.serverTimestamp(),
    };
    if (opts?.actorUserId) payload.reachBoostUpdatedBy = String(opts.actorUserId);
    await fs.collection('posts').doc(id).set(payload, { merge: true });
    return { ok: true };
  } catch (e: any) {
    const detail = e?.message || String(e);
    logger.error(
      { err: detail, postId: id, boosted },
      '[firestore-admin] setPostReachBoostedFs failed',
    );
    return { ok: false, detail };
  }
}

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
/** Remote kill-switch for live streaming (appConfig/streaming). */
/**
 * Server-authoritative live directory publish.
 * Card visibility must track Dynamo LIVE — never rely solely on the host client
 * Firestore write (Cognito/Firebase uid mismatch or rules can leave ghosts).
 */
export async function publishFirestoreLiveDirectory(input: {
  streamId: string;
  hostUserId: string;
  title?: string | null;
}): Promise<{ ok: boolean; detail?: string }> {
  const fs = getFirestore();
  const streamId = String(input.streamId || '').trim();
  const hostUserId = String(input.hostUserId || '').trim();
  if (!fs || !streamId || !hostUserId) return { ok: false, detail: 'unavailable' };

  let hostUsername: string | null = null;
  let hostDisplayName: string | null = null;
  let hostPhotoURL: string | null = null;
  try {
    const userSnap = await fs.collection('users').doc(hostUserId).get();
    if (userSnap.exists) {
      const u = userSnap.data() || {};
      hostUsername = str(u.username || u.handle || '') || null;
      hostDisplayName =
        str(u.displayName || u.name || u.username || u.handle || '') || hostUserId;
      hostPhotoURL = str(u.photoURL || u.avatarUrl || u.profilePicture || '') || null;
    }
  } catch {
    // best-effort identity enrichment
  }
  if (!hostDisplayName) hostDisplayName = hostUserId;

  const title = str(input.title || '').trim() || 'Live Stream';
  const livePayload = {
    streamId,
    userId: hostUserId,
    hostUid: hostUserId,
    hostDisplayName,
    hostUsername,
    hostPhotoURL,
    title,
    status: 'live',
    directoryReady: true,
    viewerCount: 0,
    peakViewerCount: 0,
    totalViews: 0,
    likes: 0,
    lastHeartbeatAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    adminForceEnded: false,
  };

  try {
    await Promise.all([
      fs.collection('liveStreams').doc(streamId).set(livePayload, { merge: true }),
      fs.collection('streams').doc(streamId).set(
        {
          hostUid: hostUserId,
          hostDisplayName,
          hostUsername,
          hostPhotoURL,
          title,
          status: 'live',
          directoryReady: true,
          createdAt: FieldValue.serverTimestamp(),
          viewerCount: 0,
          peakViewerCount: 0,
          totalViews: 0,
          likes: 0,
        },
        { merge: true },
      ),
      fs.collection('users').doc(hostUserId).set(
        {
          status: 'live',
          currentStreamId: streamId,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      ),
    ]);
    logger.info({ streamId, hostUserId }, '[firestore-admin] publishFirestoreLiveDirectory ok');
    return { ok: true };
  } catch (e: any) {
    logger.error(
      { err: e?.message || String(e), streamId, hostUserId },
      '[firestore-admin] publishFirestoreLiveDirectory failed',
    );
    return { ok: false, detail: e?.message || String(e) };
  }
}

/** End every status=live directory card for a host except the active session. */
export async function endPriorLiveDirectoryForHost(
  hostUserId: string,
  exceptStreamId?: string | null,
): Promise<{ ok: boolean; ended: number; detail?: string }> {
  const fs = getFirestore();
  const hostId = String(hostUserId || '').trim();
  const exceptId = String(exceptStreamId || '').trim();
  if (!fs || !hostId) return { ok: false, ended: 0, detail: 'unavailable' };

  const endOne = async (id: string) => {
    await endFirestoreStream(id);
  };

  try {
    const fields = ['hostUid', 'userId'] as const;
    const seen = new Set<string>();
    for (const field of fields) {
      let snap;
      try {
        snap = await fs
          .collection('liveStreams')
          .where(field, '==', hostId)
          .where('status', '==', 'live')
          .limit(25)
          .get();
      } catch (indexErr: any) {
        // Composite index may be missing — fall back to host field only and filter.
        logger.warn(
          { field, err: indexErr?.message || String(indexErr) },
          '[firestore-admin] endPriorLiveDirectoryForHost falling back',
        );
        snap = await fs.collection('liveStreams').where(field, '==', hostId).limit(40).get();
      }
      for (const doc of snap.docs) {
        if (exceptId && doc.id === exceptId) continue;
        if (seen.has(doc.id)) continue;
        const status = String((doc.data() || {}).status || '').toLowerCase();
        if (status && status !== 'live') continue;
        seen.add(doc.id);
        await endOne(doc.id);
      }
    }
    return { ok: true, ended: seen.size };
  } catch (e: any) {
    logger.warn(
      { err: e?.message || String(e), hostUserId: hostId },
      '[firestore-admin] endPriorLiveDirectoryForHost failed',
    );
    return { ok: false, ended: 0, detail: e?.message || String(e) };
  }
}

/** Best-effort: mark a Firestore liveStreams doc ended so discovery + profile badges clear. */
export async function endFirestoreStream(streamId: string): Promise<{ ok: boolean; detail?: string }> {
  const fs = getFirestore();
  const id = String(streamId || '').trim();
  if (!fs || !id) return { ok: false, detail: 'unavailable' };
  try {
    let hostUid: string | null = null;
    try {
      const existing = await fs.collection('liveStreams').doc(id).get();
      if (existing.exists) {
        const data = existing.data() || {};
        hostUid = str(data.hostUid || data.userId || '') || null;
      }
    } catch {
      // ignore — still attempt end write
    }

    const endedPayload = {
      status: 'ended',
      directoryReady: false,
      endedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      lastHeartbeatAt: FieldValue.serverTimestamp(),
      adminForceEnded: true,
      viewerCount: 0,
    };
    await Promise.all([
      fs.collection('liveStreams').doc(id).set(endedPayload, { merge: true }),
      fs.collection('streams').doc(id).set(
        {
          status: 'ended',
          directoryReady: false,
          endedAt: FieldValue.serverTimestamp(),
          viewerCount: 0,
        },
        { merge: true },
      ),
    ]);

    // Clear profile "is live" badge / currentStreamId when it still points here.
    if (hostUid) {
      try {
        const userRef = fs.collection('users').doc(hostUid);
        const userSnap = await userRef.get();
        const cur = userSnap.exists ? str((userSnap.data() || {}).currentStreamId || '') : '';
        if (!cur || cur === id) {
          await userRef.set(
            {
              status: 'offline',
              currentStreamId: null,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
        }
      } catch (userErr: any) {
        logger.warn(
          { err: userErr?.message || String(userErr), streamId: id, hostUid },
          '[firestore-admin] endFirestoreStream user status clear failed',
        );
      }
    }

    return { ok: true };
  } catch (e: any) {
    logger.error({ err: e?.message || String(e), streamId: id }, '[firestore-admin] endFirestoreStream failed');
    return { ok: false, detail: e?.message || String(e) };
  }
}

/** Ops / join-path: end status=live cards whose heartbeat is stale. */
export async function sweepStaleLiveDirectory(opts?: {
  staleMs?: number;
  limit?: number;
}): Promise<{ ok: boolean; swept: number; ids: string[]; detail?: string }> {
  const fs = getFirestore();
  if (!fs) return { ok: false, swept: 0, ids: [], detail: 'unavailable' };
  const staleMs = Math.max(60_000, Number(opts?.staleMs) || 5 * 60_000);
  const limit = Math.min(100, Math.max(1, Number(opts?.limit) || 40));
  const cutoff = new Date(Date.now() - staleMs);
  const ids: string[] = [];
  try {
    // status=live without a recent heartbeat — these are unjoinable ghosts.
    const snap = await fs.collection('liveStreams').where('status', '==', 'live').limit(limit).get();
    for (const doc of snap.docs) {
      const data = doc.data() || {};
      const hb = data.lastHeartbeatAt?.toDate?.() as Date | undefined;
      if (hb && hb.getTime() >= cutoff.getTime()) continue;
      const result = await endFirestoreStream(doc.id);
      if (result.ok) ids.push(doc.id);
    }
    logger.warn({ swept: ids.length, staleMs, ids }, '[firestore-admin] sweepStaleLiveDirectory');
    return { ok: true, swept: ids.length, ids };
  } catch (e: any) {
    logger.error({ err: e?.message || String(e) }, '[firestore-admin] sweepStaleLiveDirectory failed');
    return { ok: false, swept: ids.length, ids, detail: e?.message || String(e) };
  }
}

export async function getStreamingConfig(): Promise<{ enabled: boolean | null; reason?: string | null; detail?: string }> {
  const fs = getFirestore();
  if (!fs) return { enabled: null, detail: 'firestore_unavailable' };
  try {
    const snap = await fs.collection('appConfig').doc('streaming').get();
    if (!snap.exists) return { enabled: null };
    const data = snap.data() || {};
    const enabled = typeof data.enabled === 'boolean' ? data.enabled : null;
    const reason = data.reason != null ? String(data.reason) : null;
    return { enabled, reason };
  } catch (e: any) {
    logger.error({ err: e?.message || String(e) }, '[firestore-admin] getStreamingConfig failed');
    return { enabled: null, detail: e?.message || String(e) };
  }
}

export async function setStreamingConfig(input: {
  enabled: boolean;
  reason?: string | null;
  actorUserId?: string | null;
}): Promise<{ ok: boolean; enabled: boolean; detail?: string }> {
  const fs = getFirestore();
  if (!fs) return { ok: false, enabled: input.enabled, detail: 'firestore_unavailable' };
  try {
    const payload: Record<string, unknown> = {
      enabled: input.enabled === true,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (input.reason != null) payload.reason = String(input.reason).trim().slice(0, 500) || null;
    if (input.actorUserId) payload.updatedBy = String(input.actorUserId);
    await fs.collection('appConfig').doc('streaming').set(payload, { merge: true });
    return { ok: true, enabled: input.enabled === true };
  } catch (e: any) {
    const detail = e?.message || String(e);
    logger.error({ err: detail }, '[firestore-admin] setStreamingConfig failed');
    return { ok: false, enabled: input.enabled, detail };
  }
}

/**
 * Queue one content-gift push/inbox item on the shared notification spine.
 *
 * A Firestore post lookup is the context gate: live/battle gifts share the same
 * economy endpoint but do not have a matching posts/{streamId} document. The
 * post's canonical owner must also match the credited receiver, otherwise no
 * potentially false earnings notification is sent.
 */
export async function enqueuePostGiftNotification(input: {
  giftEventId: string;
  senderUserId: string;
  receiverUserId: string;
  postId: string;
  giftId: string;
  giftName?: string | null;
  quantity: number;
  coinSpent: number;
}): Promise<{ ok: boolean; detail?: string }> {
  const fs = getFirestore();
  const giftEventId = String(input.giftEventId || '').trim();
  const senderUserId = String(input.senderUserId || '').trim();
  const receiverUserId = String(input.receiverUserId || '').trim();
  const postId = String(input.postId || '').trim();
  if (!fs) return { ok: false, detail: 'firestore_unavailable' };
  if (!giftEventId || !senderUserId || !receiverUserId || !postId) {
    return { ok: false, detail: 'missing_fields' };
  }

  try {
    const postSnap = await fs.collection('posts').doc(postId).get();
    if (!postSnap.exists) return { ok: true, detail: 'not_post' };

    const post = (postSnap.data() || {}) as Record<string, any>;
    const contentOwnerUserId = String(
      post.userId ||
        post.uid ||
        post.authorId ||
        post.creatorId ||
        post.user?.uid ||
        post.user?.id ||
        '',
    ).trim();
    if (!contentOwnerUserId) return { ok: true, detail: 'post_owner_missing' };
    if (contentOwnerUserId !== receiverUserId) {
      logger.warn(
        { postId, receiverUserId, contentOwnerUserId, giftEventId },
        '[firestore-admin] post gift notification skipped: credited receiver is not content owner',
      );
      return { ok: true, detail: 'post_owner_mismatch' };
    }

    const senderUserRef = fs.collection('users').doc(senderUserId);
    const ownerUserRef = fs.collection('users').doc(contentOwnerUserId);
    const [
      senderUserSnap,
      senderProfileSnap,
      ownerUserSnap,
      ownerProfileSnap,
      ownerBlockedSenderSnap,
      senderBlockedOwnerSnap,
    ] = await Promise.all([
      senderUserRef.get(),
      fs.collection('userProfiles').doc(senderUserId).get(),
      ownerUserRef.get(),
      fs.collection('userProfiles').doc(contentOwnerUserId).get(),
      ownerUserRef.collection('blocks').doc(senderUserId).get(),
      senderUserRef.collection('blocks').doc(contentOwnerUserId).get(),
    ]);

    const blocked = postGiftBlockReason(ownerBlockedSenderSnap.exists, senderBlockedOwnerSnap.exists);
    if (blocked) return { ok: true, detail: blocked };

    const senderUser = (senderUserSnap.data() || {}) as Record<string, any>;
    const senderProfile = (senderProfileSnap.data() || {}) as Record<string, any>;
    const ownerUser = (ownerUserSnap.data() || {}) as Record<string, any>;
    const ownerProfile = (ownerProfileSnap.data() || {}) as Record<string, any>;
    const senderName = pickPostGiftSenderName(senderUserId, senderUser, senderProfile);
    const pushEnabled = isPostGiftPushEnabled(ownerUser, ownerProfile);
    const notification = buildPostGiftNotification({
      giftEventId,
      senderUserId,
      contentOwnerUserId,
      postId,
      senderName,
      giftId: input.giftId,
      giftName: input.giftName,
      quantity: input.quantity,
      coinSpent: input.coinSpent,
      post,
      pushEnabled,
    });

    try {
      await fs.collection('notifications').doc(notification.id).create(notification.doc);
      return { ok: true, detail: pushEnabled ? 'queued' : 'inbox_only_preference' };
    } catch (e: any) {
      const code = e?.code || e?.status;
      if (code === 6 || code === 'already-exists' || /already exists/i.test(String(e?.message || ''))) {
        return { ok: true, detail: 'already_queued' };
      }
      throw e;
    }
  } catch (e: any) {
    const detail = e?.message || String(e);
    logger.error(
      { err: detail, giftEventId, postId, receiverUserId },
      '[firestore-admin] enqueuePostGiftNotification failed',
    );
    return { ok: false, detail };
  }
}

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

/**
 * Durable in-app inbox row for an admin Comms message (broadcast or direct).
 * Same notifications/{id} spine the Messenger -> Notifications tab already reads.
 * Push delivery is optional (dispatcher picks up status=queued); inbox render is mandatory.
 */
export async function enqueueAdminInboxNotification(input: {
  userId: string;
  messageId: string;
  title: string;
  body: string;
  batchId?: string | null;
  segment?: string | null;
  deepLink?: string | null;
  screen?: string | null;
}): Promise<{ ok: boolean; messageId?: string; detail?: string }> {
  const fs = getFirestore();
  const userId = String(input.userId || '').trim();
  const messageId = String(input.messageId || '').trim();
  const body = String(input.body || '').trim();
  if (!fs) return { ok: false, messageId, detail: 'firestore_unavailable' };
  if (!userId || !messageId || !body) return { ok: false, messageId, detail: 'missing_fields' };

  const crypto = await import('crypto');
  const dedupeKey = `admin_msg:${messageId}`;
  const id = 'n_' + crypto.createHash('sha1').update(dedupeKey).digest('hex').slice(0, 32);
  const now = Date.now();
  const title = String(input.title || '').trim() || 'Blyp';
  const data: Record<string, string> = {
    type: 'admin',
    source: 'admin_comms',
    messageId,
  };
  if (input.batchId) data.batchId = String(input.batchId);
  if (input.segment) data.segment = String(input.segment);
  const deepLink = String(input.deepLink || '').trim();
  if (deepLink) data.deepLink = deepLink;
  const screen = String(input.screen || '').trim();
  if (screen) data.screen = screen;

  const doc = {
    userId,
    type: 'system',
    title,
    body,
    data,
    dedupeKey,
    collapseKey: input.batchId ? `admin_bcast:${input.batchId}` : `admin_msg:${messageId}`,
    status: 'queued',
    sendAfter: now,
    attempts: 0,
    maxAttempts: 5,
    nextAttemptAt: 0,
    createdAt: now,
  };

  try {
    await fs.collection('notifications').doc(id).create(doc);
    return { ok: true, messageId };
  } catch (e: any) {
    const code = e?.code || e?.status;
    if (code === 6 || code === 'already-exists' || /already exists/i.test(String(e?.message || ''))) {
      return { ok: true, messageId, detail: 'already_queued' };
    }
    const detail = e?.message || String(e);
    logger.error(
      { err: detail, userId, messageId },
      '[firestore-admin] enqueueAdminInboxNotification failed',
    );
    return { ok: false, messageId, detail };
  }
}

/** Fan-out admin inbox docs with bounded concurrency (broadcast scale). */
export async function enqueueAdminInboxNotifications(
  items: Array<{
    userId: string;
    messageId: string;
    title: string;
    body: string;
    batchId?: string | null;
    segment?: string | null;
    deepLink?: string | null;
    screen?: string | null;
  }>,
  concurrency = 40
): Promise<{ written: number; failed: number; deliveredMessageIds: string[] }> {
  let written = 0;
  let failed = 0;
  const deliveredMessageIds: string[] = [];
  const limit = Math.max(1, Math.min(80, concurrency));
  for (let i = 0; i < items.length; i += limit) {
    const chunk = items.slice(i, i + limit);
    const results = await Promise.all(chunk.map((item) => enqueueAdminInboxNotification(item)));
    for (const r of results) {
      if (r.ok) {
        written += 1;
        if (r.messageId) deliveredMessageIds.push(r.messageId);
      } else {
        failed += 1;
      }
    }
  }
  return { written, failed, deliveredMessageIds };
}

/** List posts waiting on staggered publish (import / schedule queue). */
export async function listScheduledPostsFs(opts?: {
  limit?: number;
  status?: 'scheduled' | 'paused' | 'all';
  userId?: string | null;
}): Promise<{
  items: Array<{
    postId: string;
    userId: string;
    title: string;
    publishStatus: string;
    publishAt: number | null;
    importId: string | null;
    sourcePlatform: string | null;
    sourceAccount: string | null;
    thumbnailUrl: string | null;
  }>;
  total: number;
} | null> {
  const fs = getFirestore();
  if (!fs) return null;
  const limitN = Math.max(1, Math.min(200, Number(opts?.limit) || 80));
  const want = opts?.status || 'all';
  const filterUid = String(opts?.userId || '').trim() || null;
  try {
    let snap;
    if (want === 'scheduled' || want === 'paused') {
      snap = await fs.collection('posts').where('publishStatus', '==', want).limit(250).get();
    } else {
      // Two queries; merge. Avoids 'in' limits on older SDKs.
      const [a, b] = await Promise.all([
        fs.collection('posts').where('publishStatus', '==', 'scheduled').limit(200).get(),
        fs.collection('posts').where('publishStatus', '==', 'paused').limit(100).get(),
      ]);
      const map = new Map<string, QueryDocumentSnapshot>();
      a.docs.forEach((d) => map.set(d.id, d));
      b.docs.forEach((d) => map.set(d.id, d));
      snap = { docs: Array.from(map.values()) };
    }
    let docs = snap.docs;
    if (filterUid) docs = docs.filter((d) => String((d.data() as any)?.userId || '') === filterUid);
    docs = docs.sort(
      (x, y) => Number((x.data() as any)?.publishAt || 0) - Number((y.data() as any)?.publishAt || 0),
    );
    const total = docs.length;
    const items = docs.slice(0, limitN).map((d) => {
      const p = d.data() as any;
      return {
        postId: d.id,
        userId: String(p.userId || ''),
        title: String(p.title || p.caption || '').slice(0, 120),
        publishStatus: String(p.publishStatus || ''),
        publishAt: Number(p.publishAt) > 0 ? Number(p.publishAt) : null,
        importId: p.importId ? String(p.importId) : null,
        sourcePlatform: p.sourcePlatform ? String(p.sourcePlatform) : null,
        sourceAccount: p.sourceAccount ? String(p.sourceAccount) : null,
        thumbnailUrl: p.thumbnail || p.thumbnailUrl || null,
      };
    });
    return { items, total };
  } catch (e: any) {
    logger.error({ err: e?.message || String(e) }, '[firestore-admin] listScheduledPostsFs failed');
    return null;
  }
}

export async function setScheduledPostStatusFs(
  postId: string,
  action: 'publish_now' | 'pause' | 'cancel' | 'reschedule',
  opts?: { publishAt?: number | null; actorUserId?: string | null },
): Promise<{ ok: boolean; detail?: string }> {
  const fs = getFirestore();
  const id = String(postId || '').trim();
  if (!fs) return { ok: false, detail: 'firestore_unavailable' };
  if (!id) return { ok: false, detail: 'missing_post_id' };
  const now = Date.now();
  try {
    const ref = fs.collection('posts').doc(id);
    const patch: Record<string, unknown> = { updatedAt: now };
    if (action === 'publish_now') {
      patch.publishStatus = 'live';
      patch.publishedAt = now;
      patch.publishAt = now;
    } else if (action === 'pause') {
      patch.publishStatus = 'paused';
    } else if (action === 'cancel') {
      patch.publishStatus = 'canceled';
      patch.canceledAt = now;
    } else if (action === 'reschedule') {
      const at = Number(opts?.publishAt);
      if (!Number.isFinite(at) || at <= 0) return { ok: false, detail: 'invalid_publish_at' };
      patch.publishStatus = 'scheduled';
      patch.publishAt = at;
    } else {
      return { ok: false, detail: 'invalid_action' };
    }
    if (opts?.actorUserId) patch.scheduleUpdatedBy = String(opts.actorUserId);
    await ref.set(patch, { merge: true });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, detail: e?.message || String(e) };
  }
}

/** Staff-create a social import job for a user (Admin SDK; higher stagger caps). */
export async function createSocialImportFs(input: {
  uid: string;
  platform: string;
  handle: string;
  stagger?: Record<string, unknown> | null;
  actorUserId?: string | null;
}): Promise<{ ok: boolean; id?: string; detail?: string }> {
  const fs = getFirestore();
  if (!fs) return { ok: false, detail: 'firestore_unavailable' };
  const uid = String(input.uid || '').trim();
  const platform = String(input.platform || 'tiktok').toLowerCase();
  let handle = String(input.handle || '').trim().replace(/^@+/, '');
  if (!uid || !handle) return { ok: false, detail: 'missing_uid_or_handle' };
  if (platform === 'tiktok') handle = handle.toLowerCase();

  const sourceUrl =
    platform === 'youtube'
      ? (handle.includes('youtube.com') || handle.includes('youtu.be')
        ? handle
        : `https://www.youtube.com/@${handle}/videos`)
      : `https://www.tiktok.com/@${handle}`;

  const now = Date.now();
  const staggerRaw = { ...(input.stagger || {}), isAdmin: true, enabled: input.stagger?.enabled !== false };
  const data = {
    uid,
    platform,
    handle,
    sourceUrl,
    status: 'pending',
    total: 0,
    done: 0,
    skipped: 0,
    failed: 0,
    scheduled: 0,
    claimedOwnership: true,
    stagger: staggerRaw,
    staggerPaused: false,
    createdByAdmin: input.actorUserId || null,
    message: 'Queued by admin — staggered import.',
    createdAt: now,
    updatedAt: now,
  };
  try {
    const ref = await fs.collection('socialImports').add(data);
    return { ok: true, id: ref.id };
  } catch (e: any) {
    return { ok: false, detail: e?.message || String(e) };
  }
}

export async function listSocialImportsFs(limitN = 40): Promise<
  Array<{
    id: string;
    uid: string;
    platform: string;
    handle: string;
    status: string;
    done: number;
    scheduled: number;
    total: number;
    stagger: unknown;
    message: string;
    createdAt: number | null;
    updatedAt: number | null;
  }>
> {
  const fs = getFirestore();
  if (!fs) return [];
  try {
    const snap = await fs.collection('socialImports').orderBy('createdAt', 'desc').limit(Math.min(100, limitN)).get();
    return snap.docs.map((d) => {
      const x = d.data() as any;
      return {
        id: d.id,
        uid: String(x.uid || ''),
        platform: String(x.platform || ''),
        handle: String(x.handle || ''),
        status: String(x.status || ''),
        done: Number(x.done || 0),
        scheduled: Number(x.scheduled || 0),
        total: Number(x.total || 0),
        stagger: x.stagger || null,
        message: String(x.message || ''),
        createdAt: Number(x.createdAt) || null,
        updatedAt: Number(x.updatedAt) || null,
      };
    });
  } catch (e: any) {
    logger.warn({ err: e?.message || String(e) }, '[firestore-admin] listSocialImportsFs failed');
    return [];
  }
}
