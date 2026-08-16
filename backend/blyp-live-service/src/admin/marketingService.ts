/**
 * Marketing Hub — social account linking, schedule, queue (admin console).
 * Tokens encrypted at rest; never returned to clients.
 */

import { randomUUID } from 'crypto';
import type { Knex } from 'knex';
import { getEconomyInfra } from '../economy/infra';
import { logger } from '../config/logger';
import { ensureAdminSchema } from './adminSchema';
import { listAdminGlobalPosts } from './adminInsights';
import {
  decryptMarketingToken,
  encryptMarketingToken,
  marketingCryptoConfigured,
  type MarketingTokenPayload,
} from './marketingTokenCrypto';
import {
  buildMetaAuthUrl,
  exchangeLongLivedUserToken,
  exchangeMetaCode,
  metaEnvConfigured,
  metaRedirectUri,
  publishToMeta,
  resolveMetaAccountBundle,
  signMetaOAuthState,
  type MetaNetwork,
} from './marketingMeta';

export const MARKETING_NETWORKS = ['facebook', 'instagram', 'tiktok', 'snapchat'] as const;
export type MarketingNetwork = (typeof MARKETING_NETWORKS)[number];

export const QUEUE_STATUSES = ['scheduled', 'publishing', 'published', 'failed', 'cancelled'] as const;
export type QueueStatus = (typeof QUEUE_STATUSES)[number];

export const SOURCE_MODES = ['recent_public', 'featured', 'promo_template', 'manual'] as const;
export type SourceMode = (typeof SOURCE_MODES)[number];

const DEFAULT_SCHEDULE_ID = 'default';
const BLYP_PUBLIC_BASE = 'https://blyp.world';

const PROMO_TEMPLATES: Array<{ id: string; caption: string; linkPath: string }> = [
  {
    id: 'promo_download',
    caption: 'Join Blyp — live games, gifts, and For You shorts. Download the app.',
    linkPath: '/',
  },
  {
    id: 'promo_live',
    caption: 'Go Live on Blyp — Frenemies, battles, and real-time gifts.',
    linkPath: '/',
  },
  {
    id: 'promo_foryou',
    caption: 'Discover creators on Blyp For You. Fresh clips every day.',
    linkPath: '/',
  },
];

async function getDb(): Promise<Knex> {
  const { db } = getEconomyInfra();
  await ensureAdminSchema(db);
  return db;
}

function isNetwork(v: string): v is MarketingNetwork {
  return (MARKETING_NETWORKS as readonly string[]).includes(v);
}

export type NetworkCapability = {
  network: MarketingNetwork;
  label: string;
  oauthReady: boolean;
  publishReady: boolean;
  statusHint: 'ready' | 'needs_env' | 'coming_soon';
  detail: string;
};

export function listNetworkCapabilities(): NetworkCapability[] {
  const cryptoOk = marketingCryptoConfigured();
  const metaOk = metaEnvConfigured() && cryptoOk;
  return [
    {
      network: 'facebook',
      label: 'Facebook',
      oauthReady: metaOk,
      publishReady: metaOk,
      statusHint: metaOk ? 'ready' : 'needs_env',
      detail: metaOk
        ? 'OAuth + Page feed publish available'
        : 'Set META_APP_ID, META_APP_SECRET, MARKETING_TOKEN_ENCRYPTION_KEY',
    },
    {
      network: 'instagram',
      label: 'Instagram',
      oauthReady: metaOk,
      publishReady: metaOk,
      statusHint: metaOk ? 'ready' : 'needs_env',
      detail: metaOk
        ? 'Requires IG Business/Creator linked to a Facebook Page; media URL required to publish'
        : 'Set META_APP_ID, META_APP_SECRET, MARKETING_TOKEN_ENCRYPTION_KEY',
    },
    {
      network: 'tiktok',
      label: 'TikTok',
      oauthReady: false,
      publishReady: false,
      statusHint: 'coming_soon',
      detail: 'Scaffolded — Content Posting API approval + TIKTOK_CLIENT_KEY required (see MARKETING_HUB.md)',
    },
    {
      network: 'snapchat',
      label: 'Snapchat',
      oauthReady: false,
      publishReady: false,
      statusHint: 'coming_soon',
      detail: 'Scaffolded — Marketing API / Public Profile credentials required (see MARKETING_HUB.md)',
    },
  ];
}

export type SocialAccountRow = {
  accountId: string;
  network: MarketingNetwork;
  status: string;
  displayName: string | null;
  externalUserId: string | null;
  externalPageId: string | null;
  scopes: string | null;
  tokenExpiresAt: string | null;
  metadata: Record<string, unknown>;
  connectedBy: string | null;
  connectedAt: string | null;
  updatedAt: string | null;
  createdAt: string | null;
  /** Never includes tokens */
  hasToken: boolean;
};

function mapAccount(row: any): SocialAccountRow {
  return {
    accountId: String(row.account_id),
    network: row.network as MarketingNetwork,
    status: String(row.status || 'disconnected'),
    displayName: row.display_name != null ? String(row.display_name) : null,
    externalUserId: row.external_user_id != null ? String(row.external_user_id) : null,
    externalPageId: row.external_page_id != null ? String(row.external_page_id) : null,
    scopes: row.scopes != null ? String(row.scopes) : null,
    tokenExpiresAt: row.token_expires_at ? new Date(row.token_expires_at).toISOString() : null,
    metadata: (row.metadata && typeof row.metadata === 'object' ? row.metadata : {}) as Record<
      string,
      unknown
    >,
    connectedBy: row.connected_by != null ? String(row.connected_by) : null,
    connectedAt: row.connected_at ? new Date(row.connected_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    hasToken: Boolean(row.token_ciphertext),
  };
}

export async function listMarketingAccounts(): Promise<{
  accounts: SocialAccountRow[];
  capabilities: NetworkCapability[];
  metaRedirectUri: string;
}> {
  const db = await getDb();
  const rows = await db('marketing_social_accounts').select('*').orderBy('network', 'asc');
  const byNetwork = new Map(rows.map((r) => [String(r.network), r]));
  const caps = listNetworkCapabilities();
  const accounts: SocialAccountRow[] = caps.map((cap) => {
    const existing = byNetwork.get(cap.network);
    if (existing) return mapAccount(existing);
    return {
      accountId: `placeholder_${cap.network}`,
      network: cap.network,
      status: cap.statusHint === 'coming_soon' ? 'coming_soon' : 'disconnected',
      displayName: null,
      externalUserId: null,
      externalPageId: null,
      scopes: null,
      tokenExpiresAt: null,
      metadata: { capability: cap.statusHint, detail: cap.detail },
      connectedBy: null,
      connectedAt: null,
      updatedAt: null,
      createdAt: null,
      hasToken: false,
    };
  });
  return { accounts, capabilities: caps, metaRedirectUri: metaRedirectUri() };
}

export async function startMetaConnect(input: {
  network: MetaNetwork;
  actorUserId: string;
}): Promise<{ authUrl: string; redirectUri: string }> {
  if (!metaEnvConfigured()) throw new Error('META_ENV_NOT_CONFIGURED');
  if (!marketingCryptoConfigured()) throw new Error('MARKETING_TOKEN_ENCRYPTION_KEY_REQUIRED');
  const state = signMetaOAuthState({ network: input.network, actorUserId: input.actorUserId });
  return { authUrl: buildMetaAuthUrl(input.network, state), redirectUri: metaRedirectUri() };
}

export async function completeMetaOAuth(input: {
  network: MetaNetwork;
  actorUserId: string;
  code: string;
}): Promise<SocialAccountRow> {
  if (!marketingCryptoConfigured()) throw new Error('MARKETING_TOKEN_ENCRYPTION_KEY_REQUIRED');
  const short = await exchangeMetaCode(input.code);
  const longLived = await exchangeLongLivedUserToken(short.accessToken);
  const bundle = await resolveMetaAccountBundle(
    input.network,
    longLived.accessToken,
    longLived.expiresIn ?? short.expiresIn,
  );
  const ciphertext = encryptMarketingToken(bundle.token);
  const db = await getDb();
  const accountId = randomUUID();

  await db('marketing_social_accounts')
    .where({ network: input.network })
    .del();

  await db('marketing_social_accounts').insert({
    account_id: accountId,
    network: input.network,
    status: 'connected',
    display_name: bundle.displayName,
    external_user_id: bundle.externalUserId,
    external_page_id: bundle.token.pageId || null,
    scopes: null,
    token_ciphertext: ciphertext,
    token_expires_at: bundle.token.expiresAt || null,
    metadata: bundle.metadata,
    connected_by: input.actorUserId,
    connected_at: db.fn.now(),
    updated_at: db.fn.now(),
    created_at: db.fn.now(),
  });

  const row = await db('marketing_social_accounts').where({ account_id: accountId }).first();
  return mapAccount(row);
}

export async function disconnectMarketingAccount(input: {
  network: MarketingNetwork;
  actorUserId: string;
}): Promise<{ ok: true }> {
  const db = await getDb();
  const existing = await db('marketing_social_accounts').where({ network: input.network }).first();
  if (existing) {
    const prevMeta =
      existing.metadata && typeof existing.metadata === 'object' ? existing.metadata : {};
    await db('marketing_social_accounts').where({ network: input.network }).update({
      status: 'disconnected',
      token_ciphertext: null,
      token_expires_at: null,
      updated_at: db.fn.now(),
      metadata: {
        ...prevMeta,
        disconnectedBy: input.actorUserId,
        disconnectedAt: new Date().toISOString(),
      },
    });
  }
  return { ok: true };
}

export type ScheduleConfig = {
  scheduleId: string;
  enabled: boolean;
  timezone: string;
  daysOfWeek: number[];
  timesLocal: string[];
  sourceMode: SourceMode;
  captionTemplate: string | null;
  networks: MarketingNetwork[];
  lastEnqueuedSlot: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
};

function asNumberArray(value: unknown, fallback: number[]): number[] {
  let raw = value;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return fallback;
    }
  }
  if (!Array.isArray(raw)) return fallback;
  const out = raw.map((d) => Number(d)).filter((n) => n >= 0 && n <= 6);
  return out.length ? out : fallback;
}

function asStringArray(value: unknown, fallback: string[]): string[] {
  let raw = value;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return fallback;
    }
  }
  if (!Array.isArray(raw)) return fallback;
  const out = raw.map((t) => String(t)).filter(Boolean);
  return out.length ? out : fallback;
}

function mapSchedule(row: any | null): ScheduleConfig {
  if (!row) {
    return {
      scheduleId: DEFAULT_SCHEDULE_ID,
      enabled: false,
      timezone: 'Europe/London',
      daysOfWeek: [1, 2, 3, 4, 5],
      timesLocal: ['10:00', '16:00'],
      sourceMode: 'recent_public',
      captionTemplate: '{caption}\n\nWatch on Blyp: {link}',
      networks: ['facebook'],
      lastEnqueuedSlot: null,
      updatedBy: null,
      updatedAt: null,
    };
  }
  const days = asNumberArray(row.days_of_week, [1, 2, 3, 4, 5]);
  const times = asStringArray(row.times_local, ['10:00']);
  const networks = asStringArray(row.networks, ['facebook']).filter(isNetwork) as MarketingNetwork[];
  return {
    scheduleId: String(row.schedule_id || DEFAULT_SCHEDULE_ID),
    enabled: Boolean(row.enabled),
    timezone: String(row.timezone || 'Europe/London'),
    daysOfWeek: days,
    timesLocal: times,
    sourceMode: (SOURCE_MODES as readonly string[]).includes(String(row.source_mode))
      ? (row.source_mode as SourceMode)
      : 'recent_public',
    captionTemplate: row.caption_template != null ? String(row.caption_template) : null,
    networks: networks.length ? networks : ['facebook'],
    lastEnqueuedSlot: row.last_enqueued_slot != null ? String(row.last_enqueued_slot) : null,
    updatedBy: row.updated_by != null ? String(row.updated_by) : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

export async function getMarketingSchedule(): Promise<ScheduleConfig> {
  const db = await getDb();
  const row = await db('marketing_schedules').where({ schedule_id: DEFAULT_SCHEDULE_ID }).first();
  return mapSchedule(row || null);
}

export async function upsertMarketingSchedule(input: {
  enabled?: boolean;
  timezone?: string;
  daysOfWeek?: number[];
  timesLocal?: string[];
  sourceMode?: SourceMode;
  captionTemplate?: string | null;
  networks?: MarketingNetwork[];
  actorUserId: string;
}): Promise<ScheduleConfig> {
  const current = await getMarketingSchedule();
  const next: ScheduleConfig = {
    ...current,
    enabled: input.enabled ?? current.enabled,
    timezone: input.timezone?.trim() || current.timezone,
    daysOfWeek: input.daysOfWeek ?? current.daysOfWeek,
    timesLocal: input.timesLocal ?? current.timesLocal,
    sourceMode: input.sourceMode ?? current.sourceMode,
    captionTemplate:
      input.captionTemplate !== undefined ? input.captionTemplate : current.captionTemplate,
    networks: input.networks ?? current.networks,
    updatedBy: input.actorUserId,
  };

  const db = await getDb();
  const payload = {
    schedule_id: DEFAULT_SCHEDULE_ID,
    enabled: next.enabled,
    timezone: next.timezone,
    days_of_week: next.daysOfWeek,
    times_local: next.timesLocal,
    source_mode: next.sourceMode,
    caption_template: next.captionTemplate,
    networks: next.networks,
    last_enqueued_slot: next.lastEnqueuedSlot,
    updated_by: input.actorUserId,
    updated_at: db.fn.now(),
  };

  const existing = await db('marketing_schedules').where({ schedule_id: DEFAULT_SCHEDULE_ID }).first();
  if (existing) {
    await db('marketing_schedules').where({ schedule_id: DEFAULT_SCHEDULE_ID }).update(payload);
  } else {
    await db('marketing_schedules').insert({ ...payload, created_at: db.fn.now() });
  }
  return getMarketingSchedule();
}

export type ContentSourceItem = {
  sourceType: 'blyp_post' | 'promo_template';
  sourceId: string;
  title: string;
  caption: string;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  linkUrl: string;
  authorLabel?: string;
};

export async function listMarketingContentSources(limit = 24): Promise<{
  recentPosts: ContentSourceItem[];
  promoTemplates: ContentSourceItem[];
  featuredNote: string;
}> {
  const posts = await listAdminGlobalPosts({ removed: 'live', limit, offset: 0 });
  const recentPosts: ContentSourceItem[] = posts.items.map((p) => ({
    sourceType: 'blyp_post' as const,
    sourceId: p.postId,
    title: (p.content || '').slice(0, 80) || `Post ${p.postId.slice(0, 8)}`,
    caption: p.content || '',
    mediaUrl: p.mediaUrl || p.videoUrl || p.thumbnailUrl,
    thumbnailUrl: p.thumbnailUrl || p.mediaUrl,
    linkUrl: `${BLYP_PUBLIC_BASE}/p/${encodeURIComponent(p.postId)}`,
    authorLabel: p.authorDisplayName || p.authorUsername || p.userId.slice(0, 12),
  }));

  const promoTemplates: ContentSourceItem[] = PROMO_TEMPLATES.map((t) => ({
    sourceType: 'promo_template' as const,
    sourceId: t.id,
    title: t.id,
    caption: t.caption,
    mediaUrl: null,
    thumbnailUrl: null,
    linkUrl: `${BLYP_PUBLIC_BASE}${t.linkPath}`,
  }));

  return {
    recentPosts,
    promoTemplates,
    featuredNote:
      'Featured creators lane uses recent live public posts for v1 (same pool as Content & Media).',
  };
}

function applyCaptionTemplate(
  template: string | null | undefined,
  parts: { caption: string; link: string; author?: string },
): string {
  const tpl = (template || '{caption}\n\n{link}').trim();
  return tpl
    .replace(/\{caption\}/g, parts.caption || '')
    .replace(/\{link\}/g, parts.link || '')
    .replace(/\{author\}/g, parts.author || '')
    .trim()
    .slice(0, 2200);
}

export type QueueItem = {
  itemId: string;
  network: MarketingNetwork;
  accountId: string | null;
  status: QueueStatus;
  scheduledAt: string;
  publishedAt: string | null;
  sourceType: string;
  sourcePostId: string | null;
  caption: string;
  mediaUrl: string | null;
  permalink: string | null;
  externalPostId: string | null;
  errorCode: string | null;
  errorDetail: string | null;
  attempts: number;
  createdBy: string | null;
  createdAt: string | null;
};

function mapQueue(row: any): QueueItem {
  return {
    itemId: String(row.item_id),
    network: row.network as MarketingNetwork,
    accountId: row.account_id != null ? String(row.account_id) : null,
    status: row.status as QueueStatus,
    scheduledAt: new Date(row.scheduled_at).toISOString(),
    publishedAt: row.published_at ? new Date(row.published_at).toISOString() : null,
    sourceType: String(row.source_type || 'manual'),
    sourcePostId: row.source_post_id != null ? String(row.source_post_id) : null,
    caption: String(row.caption || ''),
    mediaUrl: row.media_url != null ? String(row.media_url) : null,
    permalink: row.permalink != null ? String(row.permalink) : null,
    externalPostId: row.external_post_id != null ? String(row.external_post_id) : null,
    errorCode: row.error_code != null ? String(row.error_code) : null,
    errorDetail: row.error_detail != null ? String(row.error_detail) : null,
    attempts: Number(row.attempts || 0),
    createdBy: row.created_by != null ? String(row.created_by) : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  };
}

export async function listMarketingQueue(input: {
  status?: string;
  limit?: number;
}): Promise<{ items: QueueItem[]; total: number }> {
  const db = await getDb();
  const limit = Math.min(100, Math.max(1, input.limit || 50));
  let q = db('marketing_queue_items').select('*');
  if (input.status && input.status !== 'all') {
    q = q.where({ status: input.status });
  }
  const rows = await q.orderBy('scheduled_at', 'desc').limit(limit);
  const countQ = db('marketing_queue_items');
  if (input.status && input.status !== 'all') {
    countQ.where({ status: input.status });
  }
  const [{ count }] = await countQ.count<{ count: string }[]>('* as count');
  return { items: rows.map(mapQueue), total: Number(count || 0) };
}

export async function enqueueMarketingPost(input: {
  networks: MarketingNetwork[];
  sourceType: 'blyp_post' | 'promo_template' | 'manual';
  sourceId?: string | null;
  caption?: string | null;
  mediaUrl?: string | null;
  linkUrl?: string | null;
  scheduledAt?: string | null;
  actorUserId: string;
}): Promise<{ items: QueueItem[] }> {
  const schedule = await getMarketingSchedule();
  const sources = await listMarketingContentSources(40);
  let caption = String(input.caption || '').trim();
  let mediaUrl = input.mediaUrl || null;
  let linkUrl = input.linkUrl || `${BLYP_PUBLIC_BASE}/`;
  let sourcePostId: string | null = null;
  let author: string | undefined;

  if (input.sourceType === 'blyp_post') {
    const post = sources.recentPosts.find((p) => p.sourceId === input.sourceId) || null;
    if (!post && !caption) throw new Error('SOURCE_POST_NOT_FOUND');
    if (post) {
      caption = caption || post.caption;
      mediaUrl = mediaUrl || post.mediaUrl;
      linkUrl = post.linkUrl;
      sourcePostId = post.sourceId;
      author = post.authorLabel;
    }
  } else if (input.sourceType === 'promo_template') {
    const tpl = sources.promoTemplates.find((p) => p.sourceId === input.sourceId);
    if (!tpl) throw new Error('PROMO_TEMPLATE_NOT_FOUND');
    caption = caption || tpl.caption;
    linkUrl = tpl.linkUrl;
  }

  const finalCaption = applyCaptionTemplate(schedule.captionTemplate, {
    caption,
    link: linkUrl,
    author,
  });

  const networks = (input.networks.length ? input.networks : schedule.networks).filter(isNetwork);
  if (!networks.length) throw new Error('NO_NETWORKS_SELECTED');

  const db = await getDb();
  const accounts = await db('marketing_social_accounts').where({ status: 'connected' });
  const byNet = new Map(accounts.map((a) => [String(a.network), a]));
  const when = input.scheduledAt ? new Date(input.scheduledAt) : new Date();
  if (Number.isNaN(when.getTime())) throw new Error('INVALID_SCHEDULED_AT');

  const created: QueueItem[] = [];
  for (const network of networks) {
    const acct = byNet.get(network);
    if (!acct) {
      // Still enqueue as failed-upfront for honesty when not connected
      const itemId = randomUUID();
      await db('marketing_queue_items').insert({
        item_id: itemId,
        network,
        account_id: null,
        status: 'failed',
        scheduled_at: when.toISOString(),
        source_type: input.sourceType,
        source_post_id: sourcePostId,
        caption: finalCaption,
        media_url: mediaUrl,
        permalink: linkUrl,
        error_code: 'ACCOUNT_NOT_CONNECTED',
        error_detail: `${network} is not connected`,
        attempts: 0,
        metadata: {},
        created_by: input.actorUserId,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      });
      const row = await db('marketing_queue_items').where({ item_id: itemId }).first();
      created.push(mapQueue(row));
      continue;
    }

    const itemId = randomUUID();
    await db('marketing_queue_items').insert({
      item_id: itemId,
      network,
      account_id: acct.account_id,
      status: 'scheduled',
      scheduled_at: when.toISOString(),
      source_type: input.sourceType,
      source_post_id: sourcePostId,
      caption: finalCaption,
      media_url: mediaUrl,
      permalink: linkUrl,
      attempts: 0,
      metadata: {},
      created_by: input.actorUserId,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    const row = await db('marketing_queue_items').where({ item_id: itemId }).first();
    created.push(mapQueue(row));
  }
  return { items: created };
}

export async function cancelMarketingQueueItem(itemId: string): Promise<{ ok: true }> {
  const db = await getDb();
  const updated = await db('marketing_queue_items')
    .where({ item_id: itemId })
    .whereIn('status', ['scheduled', 'failed'])
    .update({ status: 'cancelled', updated_at: db.fn.now() });
  if (!updated) throw new Error('QUEUE_ITEM_NOT_CANCELLABLE');
  return { ok: true };
}

/** Local wall-clock parts in a given IANA timezone. */
function localParts(date: Date, timeZone: string): { day: number; hhmm: string; slotDate: string } {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  const weekday = get('weekday');
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const day = dayMap[weekday] ?? date.getUTCDay();
  const hour = get('hour').padStart(2, '0');
  const minute = get('minute').padStart(2, '0');
  const slotDate = `${get('year')}-${get('month')}-${get('day')}`;
  return { day, hhmm: `${hour}:${minute}`, slotDate };
}

/**
 * If schedule is enabled and current local time matches a configured slot (±4 min),
 * enqueue one content pick for each selected network.
 */
export async function enqueueDueScheduleSlots(now = new Date()): Promise<{
  enqueued: number;
  slot: string | null;
  skipped: string | null;
}> {
  const schedule = await getMarketingSchedule();
  if (!schedule.enabled) return { enqueued: 0, slot: null, skipped: 'paused' };
  if (schedule.sourceMode === 'manual') {
    return { enqueued: 0, slot: null, skipped: 'manual_mode' };
  }

  const { day, hhmm, slotDate } = localParts(now, schedule.timezone);
  if (!schedule.daysOfWeek.includes(day)) {
    return { enqueued: 0, slot: null, skipped: 'wrong_day' };
  }

  const match = schedule.timesLocal.find((t) => {
    const [h, m] = t.split(':').map((x) => Number(x));
    const [ch, cm] = hhmm.split(':').map((x) => Number(x));
    if ([h, m, ch, cm].some((n) => Number.isNaN(n))) return false;
    const target = h * 60 + m;
    const cur = ch * 60 + cm;
    return Math.abs(cur - target) <= 4;
  });
  if (!match) return { enqueued: 0, slot: null, skipped: 'no_time_match' };

  const slotKey = `${slotDate}T${match}@${schedule.timezone}`;
  if (schedule.lastEnqueuedSlot === slotKey) {
    return { enqueued: 0, slot: slotKey, skipped: 'already_enqueued' };
  }

  const sources = await listMarketingContentSources(30);
  let pick: ContentSourceItem | null = null;
  if (schedule.sourceMode === 'promo_template') {
    pick = sources.promoTemplates[Math.floor(Math.random() * sources.promoTemplates.length)] || null;
  } else {
    pick = sources.recentPosts[0] || sources.promoTemplates[0] || null;
  }
  if (!pick) return { enqueued: 0, slot: slotKey, skipped: 'no_content' };

  const out = await enqueueMarketingPost({
    networks: schedule.networks,
    sourceType: pick.sourceType,
    sourceId: pick.sourceId,
    caption: pick.caption,
    mediaUrl: pick.mediaUrl,
    linkUrl: pick.linkUrl,
    scheduledAt: now.toISOString(),
    actorUserId: 'system:schedule',
  });

  const db = await getDb();
  await db('marketing_schedules').where({ schedule_id: DEFAULT_SCHEDULE_ID }).update({
    last_enqueued_slot: slotKey,
    updated_at: db.fn.now(),
  });

  return { enqueued: out.items.length, slot: slotKey, skipped: null };
}

async function loadTokenForAccount(accountId: string): Promise<MarketingTokenPayload> {
  const db = await getDb();
  const row = await db('marketing_social_accounts').where({ account_id: accountId }).first();
  if (!row?.token_ciphertext) throw new Error('TOKEN_MISSING');
  return decryptMarketingToken(String(row.token_ciphertext));
}

export async function publishQueueItem(itemId: string): Promise<QueueItem> {
  const db = await getDb();
  const row = await db('marketing_queue_items').where({ item_id: itemId }).first();
  if (!row) throw new Error('QUEUE_ITEM_NOT_FOUND');
  if (row.status === 'published') return mapQueue(row);
  if (row.status === 'cancelled') throw new Error('QUEUE_ITEM_CANCELLED');

  const network = String(row.network) as MarketingNetwork;
  await db('marketing_queue_items').where({ item_id: itemId }).update({
    status: 'publishing',
    attempts: Number(row.attempts || 0) + 1,
    updated_at: db.fn.now(),
  });

  try {
    if (network === 'tiktok' || network === 'snapchat') {
      throw new Error(`${network.toUpperCase()}_NOT_IMPLEMENTED — connect API not live; see MARKETING_HUB.md`);
    }
    if (network !== 'facebook' && network !== 'instagram') {
      throw new Error(`UNSUPPORTED_NETWORK_${network}`);
    }
    if (!row.account_id) throw new Error('ACCOUNT_NOT_CONNECTED');
    const token = await loadTokenForAccount(String(row.account_id));
    const result = await publishToMeta({
      network,
      token,
      caption: String(row.caption || ''),
      linkUrl: row.permalink ? String(row.permalink) : null,
      mediaUrl: row.media_url ? String(row.media_url) : null,
    });
    await db('marketing_queue_items').where({ item_id: itemId }).update({
      status: 'published',
      published_at: db.fn.now(),
      external_post_id: result.externalPostId,
      error_code: null,
      error_detail: result.detail || null,
      updated_at: db.fn.now(),
    });
  } catch (e: any) {
    const msg = e?.message || String(e);
    logger.warn({ itemId, network, err: msg }, '[marketing] publish failed');
    await db('marketing_queue_items').where({ item_id: itemId }).update({
      status: 'failed',
      error_code: 'PUBLISH_FAILED',
      error_detail: msg.slice(0, 500),
      updated_at: db.fn.now(),
    });
  }

  const fresh = await db('marketing_queue_items').where({ item_id: itemId }).first();
  return mapQueue(fresh);
}

export async function processDueMarketingQueue(input?: {
  dryRun?: boolean;
  maxItems?: number;
}): Promise<{ ok: boolean; scanned: number; published: number; failed: number; durationMs: number }> {
  const started = Date.now();
  const db = await getDb();
  const maxItems = Math.min(50, Math.max(1, input?.maxItems || 10));
  const due = await db('marketing_queue_items')
    .where({ status: 'scheduled' })
    .andWhere('scheduled_at', '<=', new Date().toISOString())
    .orderBy('scheduled_at', 'asc')
    .limit(maxItems);

  if (input?.dryRun) {
    return {
      ok: true,
      scanned: due.length,
      published: 0,
      failed: 0,
      durationMs: Date.now() - started,
    };
  }

  let published = 0;
  let failed = 0;
  for (const row of due) {
    const out = await publishQueueItem(String(row.item_id));
    if (out.status === 'published') published += 1;
    else if (out.status === 'failed') failed += 1;
  }
  return {
    ok: failed === 0,
    scanned: due.length,
    published,
    failed,
    durationMs: Date.now() - started,
  };
}

export async function runMarketingCronSweep(input?: {
  dryRun?: boolean;
  maxItems?: number;
}): Promise<{
  ok: boolean;
  enqueue: Awaited<ReturnType<typeof enqueueDueScheduleSlots>>;
  publish: Awaited<ReturnType<typeof processDueMarketingQueue>>;
}> {
  const enqueue = input?.dryRun
    ? { enqueued: 0, slot: null, skipped: 'dry_run' }
    : await enqueueDueScheduleSlots();
  const publish = await processDueMarketingQueue(input);
  return { ok: publish.ok, enqueue, publish };
}
