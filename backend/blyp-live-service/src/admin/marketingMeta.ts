/**
 * Meta (Facebook + Instagram) OAuth connect + Graph publish helpers.
 * Env: META_APP_ID, META_APP_SECRET, META_REDIRECT_URI (optional override).
 */

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { logger } from '../config/logger';
import type { MarketingTokenPayload } from './marketingTokenCrypto';

const GRAPH = 'https://graph.facebook.com/v21.0';

export type MetaNetwork = 'facebook' | 'instagram';

export function metaEnvConfigured(): boolean {
  return Boolean(
    String(process.env.META_APP_ID || '').trim() && String(process.env.META_APP_SECRET || '').trim(),
  );
}

export function metaRedirectUri(): string {
  const explicit = String(process.env.META_REDIRECT_URI || '').trim();
  if (explicit) return explicit;
  const base = String(process.env.LIVE_SERVICE_PUBLIC_URL || process.env.PUBLIC_LIVE_SERVICE_URL || '')
    .trim()
    .replace(/\/$/, '');
  if (base) return `${base}/admin/marketing/oauth/meta/callback`;
  return 'https://blyp-live-service-innn3d7yqq-uc.a.run.app/admin/marketing/oauth/meta/callback';
}

function stateSecret(): string {
  return (
    String(process.env.MARKETING_OAUTH_STATE_SECRET || '').trim() ||
    String(process.env.MARKETING_TOKEN_ENCRYPTION_KEY || '').trim() ||
    String(process.env.META_APP_SECRET || '').trim()
  );
}

export function signMetaOAuthState(input: {
  network: MetaNetwork;
  actorUserId: string;
  nonce?: string;
}): string {
  const secret = stateSecret();
  if (!secret) throw new Error('META_OAUTH_STATE_SECRET_MISSING');
  const payload = {
    n: input.network,
    a: input.actorUserId,
    t: Date.now(),
    r: input.nonce || randomBytes(8).toString('hex'),
  };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyMetaOAuthState(
  state: string,
  maxAgeMs = 30 * 60 * 1000,
): { network: MetaNetwork; actorUserId: string } | null {
  const secret = stateSecret();
  if (!secret) return null;
  const [body, sig] = String(state || '').split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
      n?: string;
      a?: string;
      t?: number;
    };
    if (parsed.n !== 'facebook' && parsed.n !== 'instagram') return null;
    if (!parsed.a || typeof parsed.t !== 'number') return null;
    if (Date.now() - parsed.t > maxAgeMs) return null;
    return { network: parsed.n, actorUserId: parsed.a };
  } catch {
    return null;
  }
}

export function buildMetaAuthUrl(network: MetaNetwork, state: string): string {
  const appId = String(process.env.META_APP_ID || '').trim();
  const redirect = metaRedirectUri();
  const scopes =
    network === 'instagram'
      ? [
          'pages_show_list',
          'pages_read_engagement',
          'pages_manage_posts',
          'instagram_basic',
          'instagram_content_publish',
          'business_management',
        ]
      : ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'public_profile'];
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirect,
    state,
    scope: scopes.join(','),
    response_type: 'code',
  });
  return `https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}`;
}

async function graphGet<T>(path: string, accessToken: string, query: Record<string, string> = {}): Promise<T> {
  const q = new URLSearchParams({ ...query, access_token: accessToken });
  const url = `${GRAPH}${path}?${q.toString()}`;
  const res = await fetch(url);
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; code?: number } };
  if (!res.ok || (data as any)?.error) {
    const msg = (data as any)?.error?.message || `Graph GET ${path} failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

async function graphPost<T>(
  path: string,
  accessToken: string,
  body: Record<string, string>,
): Promise<T> {
  const q = new URLSearchParams({ access_token: accessToken });
  const res = await fetch(`${GRAPH}${path}?${q.toString()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok || (data as any)?.error) {
    const msg = (data as any)?.error?.message || `Graph POST ${path} failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

export async function exchangeMetaCode(code: string): Promise<{
  accessToken: string;
  expiresIn?: number;
  tokenType?: string;
}> {
  const appId = String(process.env.META_APP_ID || '').trim();
  const appSecret = String(process.env.META_APP_SECRET || '').trim();
  const redirect = metaRedirectUri();
  const q = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    redirect_uri: redirect,
    code,
  });
  const res = await fetch(`${GRAPH}/oauth/access_token?${q.toString()}`);
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    token_type?: string;
    error?: { message?: string };
  };
  if (!res.ok || !data.access_token || data.error) {
    throw new Error(data.error?.message || 'META_CODE_EXCHANGE_FAILED');
  }
  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in,
    tokenType: data.token_type,
  };
}

/** Long-lived user token (≈60 days). */
export async function exchangeLongLivedUserToken(shortToken: string): Promise<{
  accessToken: string;
  expiresIn?: number;
}> {
  const appId = String(process.env.META_APP_ID || '').trim();
  const appSecret = String(process.env.META_APP_SECRET || '').trim();
  const q = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortToken,
  });
  const res = await fetch(`${GRAPH}/oauth/access_token?${q.toString()}`);
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: { message?: string };
  };
  if (!res.ok || !data.access_token || data.error) {
    logger.warn({ err: data.error?.message }, '[marketing-meta] long-lived exchange failed; using short token');
    return { accessToken: shortToken };
  }
  return { accessToken: data.access_token, expiresIn: data.expires_in };
}

export type MetaAccountBundle = {
  displayName: string;
  externalUserId: string;
  token: MarketingTokenPayload;
  metadata: Record<string, unknown>;
};

export async function resolveMetaAccountBundle(
  network: MetaNetwork,
  userAccessToken: string,
  expiresIn?: number,
): Promise<MetaAccountBundle> {
  const me = await graphGet<{ id: string; name?: string }>('/me', userAccessToken, {
    fields: 'id,name',
  });
  const pages = await graphGet<{
    data?: Array<{
      id: string;
      name?: string;
      access_token?: string;
      instagram_business_account?: { id: string };
    }>;
  }>('/me/accounts', userAccessToken, {
    fields: 'id,name,access_token,instagram_business_account',
  });

  const pageList = pages.data || [];
  const pageWithIg = pageList.find((p) => p.instagram_business_account?.id);
  const preferredPage = network === 'instagram' ? pageWithIg || pageList[0] : pageList[0];

  if (!preferredPage?.id || !preferredPage.access_token) {
    throw new Error(
      network === 'instagram'
        ? 'META_NO_IG_BUSINESS_PAGE — connect a Facebook Page linked to an Instagram Business/Creator account'
        : 'META_NO_FACEBOOK_PAGE — grant Pages access and select a Page',
    );
  }

  const expiresAt =
    typeof expiresIn === 'number' && expiresIn > 0
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : null;

  const token: MarketingTokenPayload = {
    accessToken: userAccessToken,
    pageAccessToken: preferredPage.access_token,
    pageId: preferredPage.id,
    igUserId: preferredPage.instagram_business_account?.id || null,
    expiresAt,
    tokenType: 'bearer',
  };

  if (network === 'instagram' && !token.igUserId) {
    throw new Error(
      'META_IG_ACCOUNT_MISSING — Page has no linked Instagram Business account. See admin/MARKETING_HUB.md',
    );
  }

  return {
    displayName:
      network === 'instagram'
        ? `IG via ${preferredPage.name || preferredPage.id}`
        : preferredPage.name || me.name || me.id,
    externalUserId: me.id,
    token,
    metadata: {
      pageId: preferredPage.id,
      pageName: preferredPage.name || null,
      igUserId: token.igUserId || null,
      pagesAvailable: pageList.map((p) => ({
        id: p.id,
        name: p.name || null,
        hasIg: Boolean(p.instagram_business_account?.id),
      })),
    },
  };
}

export type MetaPublishInput = {
  network: MetaNetwork;
  token: MarketingTokenPayload;
  caption: string;
  linkUrl?: string | null;
  mediaUrl?: string | null;
};

export type MetaPublishResult = {
  externalPostId: string;
  detail?: string;
};

/**
 * Honest publish: Facebook Page feed (message + optional link).
 * Instagram: image container publish only when a public https mediaUrl is provided.
 */
export async function publishToMeta(input: MetaPublishInput): Promise<MetaPublishResult> {
  const pageToken = input.token.pageAccessToken || input.token.accessToken;
  const pageId = input.token.pageId;
  if (!pageToken || !pageId) {
    throw new Error('META_PAGE_TOKEN_MISSING');
  }

  if (input.network === 'facebook') {
    const body: Record<string, string> = { message: input.caption };
    if (input.linkUrl) body.link = input.linkUrl;
    const out = await graphPost<{ id?: string }>(`/${pageId}/feed`, pageToken, body);
    if (!out.id) throw new Error('META_FB_PUBLISH_NO_ID');
    return { externalPostId: out.id };
  }

  // Instagram content publishing API
  const igUserId = input.token.igUserId;
  if (!igUserId) throw new Error('META_IG_USER_MISSING');
  const mediaUrl = String(input.mediaUrl || '').trim();
  if (!mediaUrl || !/^https:\/\//i.test(mediaUrl)) {
    throw new Error(
      'META_IG_MEDIA_REQUIRED — Instagram publish needs a public https image/video URL (caption-only not supported)',
    );
  }

  const isVideo = /\.(mp4|mov|m4v)(\?|$)/i.test(mediaUrl) || /video/i.test(mediaUrl);
  const createBody: Record<string, string> = {
    caption: input.caption,
  };
  if (isVideo) {
    createBody.media_type = 'VIDEO';
    createBody.video_url = mediaUrl;
  } else {
    createBody.image_url = mediaUrl;
  }

  const created = await graphPost<{ id?: string }>(`/${igUserId}/media`, pageToken, createBody);
  if (!created.id) throw new Error('META_IG_CONTAINER_FAILED');

  // Poll container briefly for video; images usually ready immediately.
  if (isVideo) {
    for (let i = 0; i < 8; i += 1) {
      await new Promise((r) => setTimeout(r, 2000));
      const status = await graphGet<{ status_code?: string }>(`/${created.id}`, pageToken, {
        fields: 'status_code',
      });
      if (status.status_code === 'FINISHED') break;
      if (status.status_code === 'ERROR') throw new Error('META_IG_VIDEO_PROCESS_ERROR');
    }
  }

  const published = await graphPost<{ id?: string }>(`/${igUserId}/media_publish`, pageToken, {
    creation_id: created.id,
  });
  if (!published.id) throw new Error('META_IG_PUBLISH_NO_ID');
  return { externalPostId: published.id, detail: `container=${created.id}` };
}
