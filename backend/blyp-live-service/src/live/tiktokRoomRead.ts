/**
 * Read-only TikTok LIVE room ingest for Studio.
 * Does not start PK, send chat, or touch RTMP fan-out.
 *
 * TikTok has no public LIVE chat API. We subscribe to the public webcast
 * as a viewer using the creator @handle (same class of read path as
 * Streamlabs-style overlays).
 */

import { logger } from '../config/logger';
import { getEconomyInfra } from '../economy/infra';

export type TikTokRoomEventKind = 'chat' | 'gift';

export type TikTokRoomEvent = {
  id: string;
  kind: TikTokRoomEventKind;
  uniqueId: string;
  displayName: string;
  text: string;
  createdAt: number;
};

export type TikTokRoomStatus = {
  sessionId: string;
  uniqueId: string | null;
  phase: 'idle' | 'connecting' | 'live' | 'waiting' | 'failed' | 'stopped';
  message: string | null;
  lastEventAt: number | null;
  configured: boolean;
};

type RoomHandle = {
  disconnect: () => void;
};

type RoomConn = {
  sessionId: string;
  uniqueId: string;
  handle: RoomHandle | null;
  phase: TikTokRoomStatus['phase'];
  message: string | null;
  lastEventAt: number | null;
  retryAt: NodeJS.Timeout | null;
  stopped: boolean;
};

const rooms = new Map<string, RoomConn>();
const EVENTS_KEY = (sessionId: string) => `tiktokRoom:events:${sessionId}`;
const STATUS_KEY = (sessionId: string) => `tiktokRoom:status:${sessionId}`;
const EVENTS_CAP = 80;
const REDIS_TTL_SEC = 8 * 60 * 60;
const RETRY_MS = 8_000;

export function isTikTokRoomConfigured(): boolean {
  return true;
}

export function normalizeTikTokUniqueId(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/^https?:\/\/(www\.)?tiktok\.com\/@/i, '')
    .replace(/^@/, '')
    .split(/[/?#]/)[0]
    .trim();
}

export function validateTikTokUniqueId(
  raw: string,
): { ok: true; uniqueId: string } | { ok: false; message: string } {
  const uniqueId = normalizeTikTokUniqueId(raw);
  if (!/^[A-Za-z0-9._]{2,24}$/.test(uniqueId)) {
    return {
      ok: false,
      message: 'TikTok handle must be 2–24 letters, numbers, dots, or underscores',
    };
  }
  return { ok: true, uniqueId };
}

function pickStr(...vals: unknown[]): string {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return '';
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function eventType(row: Record<string, unknown>): string {
  return pickStr(row.type, row.event, row.eventType, row.method).toLowerCase();
}

function userFrom(row: Record<string, unknown>): { uniqueId: string; displayName: string } {
  const user = asRecord(row.user) || asRecord(row.userInfo) || asRecord(row.fromUser) || {};
  const uniqueId = pickStr(
    user.uniqueId,
    user.unique_id,
    user.displayId,
    user.display_id,
    row.uniqueId,
  );
  const displayName = pickStr(user.nickname, user.nickName, user.displayName, uniqueId) || 'TikTok';
  return { uniqueId: uniqueId || 'tiktok', displayName };
}

export function mapTikTokRoomPayload(raw: unknown): TikTokRoomEvent[] {
  const now = Date.now();
  const out: TikTokRoomEvent[] = [];

  const pushChat = (row: Record<string, unknown>) => {
    const text = pickStr(row.content, row.comment, row.text, row.message);
    if (!text) return;
    const who = userFrom(row);
    out.push({
      id: `tt-chat-${pickStr(row.msgId, row.id, asRecord(row.common)?.msgId) || `${who.uniqueId}-${now}-${out.length}`}`,
      kind: 'chat',
      uniqueId: who.uniqueId,
      displayName: who.displayName,
      text,
      createdAt: now,
    });
  };

  const pushGift = (row: Record<string, unknown>) => {
    const gift = asRecord(row.gift) || asRecord(row.giftDetails) || asRecord(row.giftInfo) || {};
    const name = pickStr(
      row.giftName,
      gift.giftName,
      gift.name,
      gift.describe,
      asRecord(gift.describe)?.name,
      'Gift',
    );
    const count = Number(
      pickStr(row.repeatCount, row.repeat_count, gift.repeatCount, row.comboCount) || '1',
    );
    const who = userFrom(row);
    const n = Number.isFinite(count) && count > 1 ? count : 1;
    out.push({
      id: `tt-gift-${pickStr(row.msgId, row.id, asRecord(row.common)?.msgId) || `${who.uniqueId}-${now}-${out.length}`}`,
      kind: 'gift',
      uniqueId: who.uniqueId,
      displayName: who.displayName,
      text: n > 1 ? `sent ${name} ×${n}` : `sent ${name}`,
      createdAt: now,
    });
  };

  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const row = asRecord(node);
    if (!row) return;

    if (Array.isArray(row.messages)) visit(row.messages);
    if (Array.isArray(row.events)) visit(row.events);
    if (row.data && typeof row.data === 'object') {
      const nested = asRecord(row.data);
      if (nested && (nested.comment || nested.content || nested.gift || nested.user || nested.giftName)) {
        const t = eventType(row) || eventType(nested);
        if (t.includes('gift')) pushGift({ ...nested, ...row, user: nested.user || row.user });
        else if (t.includes('chat') || nested.comment || nested.content || row.comment || row.content) {
          pushChat({ ...nested, ...row, content: nested.content || row.content, comment: nested.comment || row.comment });
        }
      }
    }

    const t = eventType(row);
    if (t.includes('gift')) {
      pushGift(row);
      return;
    }
    if (t.includes('chat') || row.comment || row.content) {
      pushChat(row);
    }
  };

  visit(raw);

  const seen = new Set<string>();
  return out.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
}

async function redisSafe<T>(fn: (r: ReturnType<typeof getEconomyInfra>['redis']) => Promise<T>): Promise<T | null> {
  try {
    const { redis } = getEconomyInfra();
    if (redis.status !== 'ready') {
      await redis.connect().catch(() => undefined);
    }
    return await fn(redis);
  } catch (e: any) {
    logger.warn({ err: e?.message || String(e) }, '[tiktok-room] redis skip');
    return null;
  }
}

async function persistStatus(conn: RoomConn): Promise<void> {
  const view: TikTokRoomStatus = {
    sessionId: conn.sessionId,
    uniqueId: conn.uniqueId,
    phase: conn.phase,
    message: conn.message,
    lastEventAt: conn.lastEventAt,
    configured: true,
  };
  await redisSafe(async (redis) => {
    await redis.set(STATUS_KEY(conn.sessionId), JSON.stringify(view), 'EX', REDIS_TTL_SEC);
  });
}

async function persistEvents(sessionId: string, events: TikTokRoomEvent[]): Promise<void> {
  if (!events.length) return;
  await redisSafe(async (redis) => {
    const key = EVENTS_KEY(sessionId);
    const pipe = redis.pipeline();
    for (const ev of events) pipe.lpush(key, JSON.stringify(ev));
    pipe.ltrim(key, 0, EVENTS_CAP - 1);
    pipe.expire(key, REDIS_TTL_SEC);
    await pipe.exec();
  });
}

function scheduleRetry(conn: RoomConn, delayMs = RETRY_MS): void {
  if (conn.stopped) return;
  if (conn.retryAt) clearTimeout(conn.retryAt);
  conn.retryAt = setTimeout(() => {
    conn.retryAt = null;
    if (conn.stopped) return;
    void openConnection(conn);
  }, delayMs);
}

function ingest(conn: RoomConn, raw: unknown): void {
  if (conn.stopped) return;
  const events = mapTikTokRoomPayload(raw);
  if (!events.length) return;
  conn.lastEventAt = Date.now();
  conn.phase = 'live';
  void persistEvents(conn.sessionId, events);
  void persistStatus(conn);
}

async function loadConnector(): Promise<typeof import('tiktok-live-connector')> {
  // live-service compiles to CJS; this package is ESM-only.
  return Function('return import("tiktok-live-connector")')() as Promise<
    typeof import('tiktok-live-connector')
  >;
}

async function openConnection(conn: RoomConn): Promise<void> {
  if (conn.stopped) return;
  try {
    conn.handle?.disconnect();
  } catch {
    /* ignore */
  }
  conn.handle = null;

  conn.phase = conn.phase === 'waiting' ? 'waiting' : 'connecting';
  conn.message = conn.phase === 'waiting' ? 'Waiting for TikTok LIVE…' : 'Connecting TikTok chat…';
  void persistStatus(conn);

  try {
    const mod = await loadConnector();
    const connection = new mod.TikTokLiveConnection(conn.uniqueId, {
      processInitialData: true,
      enableExtendedGiftInfo: false,
    });
    connection.on(mod.WebcastEvent.CHAT, (data: unknown) => ingest(conn, data));
    connection.on(mod.WebcastEvent.GIFT, (data: unknown) => ingest(conn, data));
    connection.on(mod.ControlEvent.DISCONNECTED, () => {
      if (conn.stopped) return;
      conn.phase = 'connecting';
      conn.message = 'Reconnecting TikTok chat…';
      void persistStatus(conn);
      scheduleRetry(conn, RETRY_MS);
    });

    conn.handle = {
      disconnect: () => {
        try {
          connection.disconnect();
        } catch {
          /* ignore */
        }
      },
    };

    await connection.connect();
    if (conn.stopped) {
      connection.disconnect();
      return;
    }
    conn.phase = 'live';
    conn.message = `Reading @${conn.uniqueId}`;
    void persistStatus(conn);
    logger.info({ sessionId: conn.sessionId, uniqueId: conn.uniqueId }, '[tiktok-room] connected');
  } catch (e: any) {
    const msg = String(e?.message || e);
    const notLive = /not live|offline|room.?id|user_not_found|404/i.test(msg);
    if (conn.stopped) return;
    conn.phase = notLive ? 'waiting' : 'connecting';
    conn.message = notLive ? 'TikTok is not live yet — retrying' : `Reconnecting (${msg.slice(0, 80)})`;
    void persistStatus(conn);
    logger.warn({ sessionId: conn.sessionId, err: msg }, '[tiktok-room] connect failed');
    scheduleRetry(conn, RETRY_MS);
  }
}

export async function startTikTokRoom(input: {
  sessionId: string;
  uniqueId: string;
}): Promise<TikTokRoomStatus> {
  const parsed = validateTikTokUniqueId(input.uniqueId);
  if (!parsed.ok) {
    const err = new Error(parsed.message) as Error & { code: string };
    err.code = 'INVALID_UNIQUE_ID';
    throw err;
  }

  const existing = rooms.get(input.sessionId);
  if (existing && existing.uniqueId === parsed.uniqueId && !existing.stopped) {
    return getTikTokRoomStatus(input.sessionId);
  }
  if (existing) {
    await stopTikTokRoom(input.sessionId);
  }

  const conn: RoomConn = {
    sessionId: input.sessionId,
    uniqueId: parsed.uniqueId,
    handle: null,
    phase: 'connecting',
    message: 'Connecting TikTok chat…',
    lastEventAt: null,
    retryAt: null,
    stopped: false,
  };
  rooms.set(input.sessionId, conn);
  await persistStatus(conn);
  void openConnection(conn);
  return getTikTokRoomStatus(input.sessionId);
}

export async function stopTikTokRoom(sessionId: string): Promise<TikTokRoomStatus> {
  const conn = rooms.get(sessionId);
  if (conn) {
    conn.stopped = true;
    if (conn.retryAt) clearTimeout(conn.retryAt);
    conn.retryAt = null;
    try {
      conn.handle?.disconnect();
    } catch {
      /* ignore */
    }
    conn.handle = null;
    conn.phase = 'stopped';
    conn.message = 'Stopped';
    await persistStatus(conn);
    rooms.delete(sessionId);
  }
  return getTikTokRoomStatus(sessionId);
}

export async function getTikTokRoomStatus(sessionId: string): Promise<TikTokRoomStatus> {
  const live = rooms.get(sessionId);
  if (live) {
    return {
      sessionId,
      uniqueId: live.uniqueId,
      phase: live.phase,
      message: live.message,
      lastEventAt: live.lastEventAt,
      configured: true,
    };
  }
  const cached = await redisSafe(async (redis) => redis.get(STATUS_KEY(sessionId)));
  if (cached) {
    try {
      return JSON.parse(cached) as TikTokRoomStatus;
    } catch {
      /* fall through */
    }
  }
  return {
    sessionId,
    uniqueId: null,
    phase: 'idle',
    message: null,
    lastEventAt: null,
    configured: true,
  };
}

export async function listTikTokRoomEvents(sessionId: string): Promise<TikTokRoomEvent[]> {
  const rows = await redisSafe(async (redis) => redis.lrange(EVENTS_KEY(sessionId), 0, EVENTS_CAP - 1));
  if (!rows?.length) return [];
  const out: TikTokRoomEvent[] = [];
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row) as TikTokRoomEvent;
      if (parsed?.text) out.push(parsed);
    } catch {
      /* skip */
    }
  }
  return out;
}
