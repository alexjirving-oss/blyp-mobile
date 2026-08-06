import crypto from 'crypto';
import { getEconomyInfra } from '../economy/infra';
import { listDirectoryUsers, type DirectoryUser } from './adminCognitoDirectory';
import { countFirestoreCollection, listFirestorePostsWindow } from './firestoreAdmin';
import { writeAdminAudit } from './adminService';

function db() {
  return getEconomyInfra().db;
}

function dayKey(iso: string | null): string | null {
  if (!iso) return null;
  return iso.slice(0, 10);
}

// Build a zero-filled series of the last `days` calendar days (UTC).
function buildSeries(isoDates: Array<string | null>, days: number): Array<{ date: string; count: number }> {
  const counts = new Map<string, number>();
  for (const iso of isoDates) {
    const key = dayKey(iso);
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  }
  const out: Array<{ date: string; count: number }> = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    out.push({ date: key, count: counts.get(key) || 0 });
  }
  return out;
}

export async function getAdminAnalytics(): Promise<Record<string, unknown>> {
  const [directoryUsers, posts, postCount] = await Promise.all([
    listDirectoryUsers().catch(() => [] as DirectoryUser[]),
    listFirestorePostsWindow().catch(() => null),
    countFirestoreCollection('posts').catch(() => null),
  ]);

  const signupsByDay = buildSeries(directoryUsers.map((u) => u.createdAt), 30);
  const postsByDay = buildSeries((posts || []).map((p) => p.createdAt), 30);

  // Top creators by post count within the recent window.
  const byUser = new Map<string, number>();
  for (const p of posts || []) {
    if (p.userId) byUser.set(p.userId, (byUser.get(p.userId) || 0) + 1);
  }
  const dirById = new Map<string, DirectoryUser>();
  for (const d of directoryUsers) dirById.set(d.userId, d);
  const topCreators = Array.from(byUser.entries())
    .map(([userId, count]) => ({
      userId,
      count,
      displayName: dirById.get(userId)?.displayName || dirById.get(userId)?.username || userId,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Country breakdown from the directory.
  const byCountry = new Map<string, number>();
  for (const u of directoryUsers) {
    const c = (u.country || '').trim() || 'Unknown';
    byCountry.set(c, (byCountry.get(c) || 0) + 1);
  }
  const countries = Array.from(byCountry.entries())
    .map(([country, count]) => ({ country, count }))
    .sort((a, b) => b.count - a.count);

  const signups7d = signupsByDay.slice(-7).reduce((s, d) => s + d.count, 0);
  const posts7d = postsByDay.slice(-7).reduce((s, d) => s + d.count, 0);

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      directoryUsers: directoryUsers.length,
      totalPosts: postCount ?? (posts ? posts.length : 0),
      postsCounted: postCount != null,
      signups7d,
      posts7d,
    },
    signupsByDay,
    postsByDay,
    topCreators,
    countries,
  };
}

type Segment = 'all' | 'active' | 'banned';

async function resolveSegmentUserIds(segment: Segment): Promise<string[]> {
  const directoryUsers = await listDirectoryUsers().catch(() => [] as DirectoryUser[]);

  let bannedIds = new Set<string>();
  try {
    const rows = await db()('user_admin_state').select('user_id').where('is_banned', true);
    bannedIds = new Set((rows as Array<any>).map((r) => String(r.user_id)));
  } catch {
    // ignore
  }

  if (segment === 'banned') {
    return Array.from(bannedIds);
  }
  if (segment === 'active') {
    return directoryUsers.filter((u) => u.enabled !== false && !bannedIds.has(u.userId)).map((u) => u.userId);
  }
  return directoryUsers.map((u) => u.userId);
}

export async function broadcastAdminMessage(input: {
  actorUserId: string;
  segment: Segment;
  subject: string | null;
  message: string;
}): Promise<{ queued: number; segment: Segment }> {
  const userIds = await resolveSegmentUserIds(input.segment);
  const batchId = `bcast_${crypto.randomBytes(6).toString('hex')}`;

  let queued = 0;
  if (userIds.length > 0) {
    const rows = userIds.map((userId) => ({
      message_id: `admmsg_${crypto.randomBytes(8).toString('hex')}`,
      user_id: userId,
      channel: 'in_app',
      status: 'queued',
      subject: input.subject,
      body: input.message,
      metadata: JSON.stringify({ actorUserId: input.actorUserId, broadcast: true, batchId, segment: input.segment }),
    }));

    // Chunked insert to stay well within parameter limits.
    const chunkSize = 200;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      await db().raw(
        `INSERT INTO admin_user_messages (message_id, user_id, channel, status, subject, body, metadata)
         VALUES ${chunk.map(() => '(?, ?, ?, ?, ?, ?, ?::jsonb)').join(', ')}`,
        chunk.flatMap((r) => [r.message_id, r.user_id, r.channel, r.status, r.subject, r.body, r.metadata])
      );
      queued += chunk.length;
    }
  }

  await writeAdminAudit({
    actorUserId: input.actorUserId,
    action: 'broadcast_message',
    targetType: 'segment',
    targetId: input.segment,
    metadata: { queued, batchId, subject: input.subject },
  });

  return { queued, segment: input.segment };
}

export async function listRecentAdminMessages(input: { limit: number; offset: number }): Promise<{
  items: Array<{ messageId: string; userId: string; channel: string; status: string; subject: string; body: string; broadcast: boolean; createdAt: string | null }>;
  total: number;
  limit: number;
  offset: number;
}> {
  try {
    const [rowsRs, countRs] = await Promise.all([
      db().raw(
        `SELECT message_id, user_id, channel, status, subject, body, metadata, created_at
         FROM admin_user_messages
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
        [input.limit, input.offset]
      ),
      db().raw(`SELECT COUNT(*)::bigint AS total FROM admin_user_messages`),
    ]);
    const items = (((rowsRs as any)?.rows || []) as Array<any>).map((r) => {
      let meta: any = {};
      try { meta = typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata || {}; } catch { meta = {}; }
      return {
        messageId: String(r.message_id),
        userId: String(r.user_id),
        channel: String(r.channel || 'in_app'),
        status: String(r.status || 'queued'),
        subject: String(r.subject || ''),
        body: String(r.body || ''),
        broadcast: Boolean(meta?.broadcast),
        createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
      };
    });
    return { items, total: Number((countRs as any)?.rows?.[0]?.total || 0), limit: input.limit, offset: input.offset };
  } catch {
    return { items: [], total: 0, limit: input.limit, offset: input.offset };
  }
}

const FLAGS_KEY = 'feature_flags';

export async function getFeatureFlags(): Promise<Record<string, boolean>> {
  try {
    const rs = await db().raw(`SELECT value FROM admin_config WHERE config_key = ? LIMIT 1`, [FLAGS_KEY]);
    const value = (rs as any)?.rows?.[0]?.value;
    const parsed = typeof value === 'string' ? JSON.parse(value) : value || {};
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(parsed)) out[k] = Boolean(v);
    return out;
  } catch {
    return {};
  }
}

export async function setFeatureFlags(input: { actorUserId: string; flags: Record<string, boolean> }): Promise<Record<string, boolean>> {
  const normalized: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(input.flags || {})) normalized[k] = Boolean(v);

  await db().raw(
    `INSERT INTO admin_config (config_key, value, updated_by_user_id, updated_at)
     VALUES (?, ?::jsonb, ?, CURRENT_TIMESTAMP)
     ON CONFLICT (config_key)
     DO UPDATE SET value = EXCLUDED.value, updated_by_user_id = EXCLUDED.updated_by_user_id, updated_at = CURRENT_TIMESTAMP`,
    [FLAGS_KEY, JSON.stringify(normalized), input.actorUserId]
  );

  await writeAdminAudit({
    actorUserId: input.actorUserId,
    action: 'feature_flags_set',
    targetType: 'config',
    targetId: FLAGS_KEY,
    metadata: { flags: normalized },
  });

  return normalized;
}

export async function getAdminCatalog(): Promise<{
  gifts: Array<{ giftId: string; name: string; coinCost: number; enabled: boolean; rarity: string }>;
  iapProducts: Array<{ platform: string; sku: string; coinsGranted: number; enabled: boolean }>;
  degraded?: boolean;
}> {
  const result: { gifts: any[]; iapProducts: any[]; degraded?: boolean } = { gifts: [], iapProducts: [] };
  try {
    const giftsRs = await db().raw(`SELECT gift_id, name, coin_cost, enabled, rarity FROM gift_catalog ORDER BY coin_cost ASC`);
    result.gifts = (((giftsRs as any)?.rows || []) as Array<any>).map((r) => ({
      giftId: String(r.gift_id),
      name: String(r.name),
      coinCost: Number(r.coin_cost || 0),
      enabled: Boolean(r.enabled),
      rarity: String(r.rarity || 'common'),
    }));
  } catch {
    result.degraded = true;
  }
  try {
    const iapRs = await db().raw(`SELECT platform, sku, coins_granted, enabled FROM iap_products ORDER BY coins_granted ASC`);
    result.iapProducts = (((iapRs as any)?.rows || []) as Array<any>).map((r) => ({
      platform: String(r.platform),
      sku: String(r.sku),
      coinsGranted: Number(r.coins_granted || 0),
      enabled: Boolean(r.enabled),
    }));
  } catch {
    result.degraded = true;
  }
  return result;
}

export async function setGiftEnabled(input: { actorUserId: string; giftId: string; enabled: boolean }): Promise<void> {
  await db().raw(`UPDATE gift_catalog SET enabled = ? WHERE gift_id = ?`, [input.enabled, input.giftId]);
  await writeAdminAudit({
    actorUserId: input.actorUserId,
    action: 'gift_catalog_update',
    targetType: 'gift',
    targetId: input.giftId,
    metadata: { enabled: input.enabled },
  });
}

type RemovedFilter = 'all' | 'live' | 'removed';

async function loadRemovedPostIds(): Promise<Set<string>> {
  try {
    const rows = await db().raw(`SELECT post_id FROM post_admin_state WHERE is_removed = true`);
    return new Set((((rows as any)?.rows || []) as Array<any>).map((r) => String(r.post_id)));
  } catch {
    return new Set();
  }
}

export async function listAdminGlobalPosts(input: {
  q?: string;
  removed?: RemovedFilter;
  limit: number;
  offset: number;
}): Promise<{
  items: Array<{
    postId: string;
    userId: string;
    content: string;
    createdAt: string | null;
    updatedAt: null;
    postType: string;
    mediaUrl: string | null;
    videoUrl: string | null;
    thumbnailUrl: string | null;
    isRemoved: boolean;
    removedReason: null;
    removedAt: null;
    authorUsername: string;
    authorDisplayName: string;
    likes: number;
    views: number;
    comments: number;
  }>;
  total: number;
  limit: number;
  offset: number;
  sourceTable: string;
  degraded?: boolean;
  detail?: string;
}> {
  const removedFilter: RemovedFilter = input.removed || 'all';
  const q = String(input.q || '').trim().toLowerCase();

  const [postsWindow, removedIds] = await Promise.all([
    listFirestorePostsWindow().catch(() => null),
    loadRemovedPostIds(),
  ]);

  if (postsWindow === null) {
    return {
      items: [],
      total: 0,
      limit: input.limit,
      offset: input.offset,
      sourceTable: 'firestore.posts',
      degraded: true,
      detail: 'firestore_unavailable',
    };
  }

  const isPostRemoved = (p: { postId: string; isHidden?: boolean }) =>
    removedIds.has(p.postId) || p.isHidden === true;

  let filtered = postsWindow;
  if (q) {
    filtered = filtered.filter((p) => {
      const hay = [
        p.content,
        p.authorUsername,
        p.authorDisplayName,
        p.userId,
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }

  if (removedFilter === 'live') {
    filtered = filtered.filter((p) => !isPostRemoved(p));
  } else if (removedFilter === 'removed') {
    filtered = filtered.filter((p) => isPostRemoved(p));
  }

  const total = filtered.length;
  const page = filtered.slice(input.offset, input.offset + input.limit);

  const items = page.map((p) => ({
    postId: p.postId,
    userId: p.userId,
    content: p.content,
    createdAt: p.createdAt,
    updatedAt: null,
    postType: p.postType,
    mediaUrl: p.mediaUrl,
    videoUrl: p.videoUrl,
    thumbnailUrl: p.thumbnailUrl,
    isRemoved: isPostRemoved(p),
    removedReason: null,
    removedAt: null,
    authorUsername: p.authorUsername,
    authorDisplayName: p.authorDisplayName,
    likes: p.likes,
    views: p.views,
    comments: p.comments,
  }));

  return {
    items,
    total,
    limit: input.limit,
    offset: input.offset,
    sourceTable: 'firestore.posts',
  };
}

export async function getOpsControlPlane(): Promise<Record<string, unknown>> {
  let enableWithdrawalsEnv = false;
  let stripeConfigured = false;
  let effectivelyEnabled = false;
  let withdrawalNote = 'Withdrawals disabled (ENABLE_WITHDRAWALS is not 1)';

  try {
    const { getEconomyEnv } = await import('../config/economyEnv');
    const { withdrawalsEnabled } = await import('../economy/withdrawalService');
    const env = getEconomyEnv();
    enableWithdrawalsEnv = Number(env.ENABLE_WITHDRAWALS || 0) === 1;
    stripeConfigured = Boolean(String(env.STRIPE_SECRET_KEY || '').trim());
    effectivelyEnabled = withdrawalsEnabled();
    if (effectivelyEnabled) {
      withdrawalNote = 'Withdrawals enabled (ENABLE_WITHDRAWALS=1 and Stripe configured)';
    } else if (enableWithdrawalsEnv && !stripeConfigured) {
      withdrawalNote = 'ENABLE_WITHDRAWALS=1 but STRIPE_SECRET_KEY is not configured';
    }
  } catch (e: any) {
    withdrawalNote = `Economy env unavailable: ${e?.message || String(e)}`;
  }

  const { getStreamingConfig } = await import('./firestoreAdmin');
  const streaming = await getStreamingConfig();
  const featureFlags = await getFeatureFlags().catch(() => ({}));

  const liveMarbleRaceEnabled = /^(1|true|yes|on)$/i.test(
    String(process.env.LIVE_MARBLE_RACE_ENABLED || '').trim(),
  );

  const { getBanCacheStats } = await import('./banGuard');
  const banCache = getBanCacheStats();

  const { DUAL_CONTROL_UI } = await import('./adminEconomyReads');

  return {
    generatedAt: new Date().toISOString(),
    withdrawals: {
      enableWithdrawalsEnv,
      stripeConfigured,
      effectivelyEnabled,
      note: withdrawalNote,
    },
    killSwitches: {
      streamingEnabled: streaming.enabled,
      featureFlags,
    },
    envReadOnly: {
      liveMarbleRaceEnabled,
    },
    banCache: {
      size: banCache.size,
      ttlMs: banCache.ttlMs,
      failOpenOnDbMiss: banCache.failOpenOnDbMiss,
      note: banCache.note,
    },
    dualControlUi: DUAL_CONTROL_UI,
  };
}
