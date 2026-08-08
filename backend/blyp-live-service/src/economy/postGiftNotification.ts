import { createHash } from 'crypto';
import { safeLiveDisplayName } from '../live/liveDisplayName';

type DataRecord = Record<string, any>;

export interface PostGiftNotificationInput {
  giftEventId: string;
  senderUserId: string;
  contentOwnerUserId: string;
  postId: string;
  senderName: string;
  giftId: string;
  giftName?: string | null;
  quantity: number;
  coinSpent: number;
  post: DataRecord;
  pushEnabled: boolean;
  now?: number;
}

export interface BuiltPostGiftNotification {
  id: string;
  dedupeKey: string;
  doc: {
    userId: string;
    type: 'activity';
    title: string;
    body: string;
    data: Record<string, string>;
    dedupeKey: string;
    collapseKey: string;
    status: 'queued' | 'no_device';
    sendAfter: number;
    attempts: number;
    maxAttempts: number;
    nextAttemptAt: number;
    createdAt: number;
    lastError?: string;
  };
}

function cleanText(value: unknown, maxLength: number): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function humanizeGiftId(giftId: string): string {
  const normalized = String(giftId || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return 'Gift';
  return normalized.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function firstExplicitFalse(values: unknown[]): boolean {
  return values.some((value) => value === false);
}

/**
 * Reads the preference shapes used by current/legacy profile writers. A disabled
 * push preference still leaves the durable in-app inbox row; the caller marks
 * that row `no_device` so the FCM dispatcher will not claim it.
 */
export function isPostGiftPushEnabled(...profiles: DataRecord[]): boolean {
  for (const profile of profiles) {
    if (!profile || typeof profile !== 'object') continue;
    const notificationPreferences = profile.notificationPreferences || {};
    const notificationPrefs = profile.notificationPrefs || {};
    const notifications = profile.notifications || {};
    const nested = profile.blyp?.prefs?.notifications || {};
    const preferences = profile.preferences?.notifications || {};

    if (
      firstExplicitFalse([
        profile.notificationsEnabled,
        profile.pushNotificationsEnabled,
        profile.pushNotifications,
        notificationPreferences.enabled,
        notificationPreferences.push,
        notificationPreferences.gift,
        notificationPreferences.gifts,
        notificationPrefs.enabled,
        notificationPrefs.push,
        notificationPrefs.gift,
        notificationPrefs.gifts,
        notifications.enabled,
        notifications.push,
        notifications.gift,
        notifications.gifts,
        nested.enabled,
        nested.push,
        nested.gift,
        nested.gifts,
        preferences.enabled,
        preferences.push,
        preferences.gift,
        preferences.gifts,
      ])
    ) {
      return false;
    }
  }
  return true;
}

/** Resolve a public username/display label without ever returning the raw uid. */
export function pickPostGiftSenderName(senderUserId: string, ...profiles: DataRecord[]): string {
  for (const profile of profiles) {
    if (!profile || typeof profile !== 'object') continue;
    const candidates = [
      profile.username,
      profile.handle,
      profile.preferredUsername,
      profile.displayName,
      profile.name,
    ];
    for (const candidate of candidates) {
      const label = safeLiveDisplayName(candidate, senderUserId, '');
      if (label) return label;
    }
  }
  return 'Someone';
}

export function postGiftBlockReason(
  contentOwnerBlockedSender: boolean,
  senderBlockedContentOwner: boolean,
): 'blocked' | null {
  return contentOwnerBlockedSender || senderBlockedContentOwner ? 'blocked' : null;
}

export function postGiftNotificationId(giftEventId: string, contentOwnerUserId: string): string {
  const dedupeKey = `post_gift:${giftEventId}:${contentOwnerUserId}`;
  return `n_${createHash('sha1').update(dedupeKey).digest('hex').slice(0, 32)}`;
}

function isVideoPost(post: DataRecord): boolean {
  const type = String(post.type || post.postType || '').toLowerCase();
  if (type.includes('video') || post.videoUrl) return true;
  const media = Array.isArray(post.media) ? post.media : [];
  return media.some((item: any) => {
    const mediaType = String(item?.type || item?.mediaType || item?.mimeType || '').toLowerCase();
    return mediaType.includes('video');
  });
}

export function buildPostGiftNotification(
  input: PostGiftNotificationInput,
): BuiltPostGiftNotification {
  const giftEventId = String(input.giftEventId || '').trim();
  const ownerId = String(input.contentOwnerUserId || '').trim();
  const postId = String(input.postId || '').trim();
  const senderId = String(input.senderUserId || '').trim();
  const senderName = safeLiveDisplayName(input.senderName, senderId, 'Someone');
  const giftName =
    cleanText(input.giftName, 48) ||
    cleanText(humanizeGiftId(input.giftId), 48) ||
    'Gift';
  const quantity = Math.max(1, Math.floor(Number(input.quantity) || 1));
  const coins = Math.max(0, Math.floor(Number(input.coinSpent) || 0));
  const contentKind = isVideoPost(input.post || {}) ? 'video' : 'post';
  const excerpt = cleanText(
    input.post?.title ||
      input.post?.captionTitle ||
      input.post?.caption ||
      input.post?.description ||
      input.post?.transcript,
    58,
  );
  const giftPhrase = quantity > 1 ? `${quantity}× ${giftName}` : giftName;
  const coinPhrase = coins > 0 ? ` · ${coins} coin${coins === 1 ? '' : 's'}` : '';
  const postPhrase = excerpt ? ` on “${excerpt}”` : '';
  const dedupeKey = `post_gift:${giftEventId}:${ownerId}`;
  const now = Number.isFinite(input.now) ? Number(input.now) : Date.now();
  const pushEnabled = input.pushEnabled !== false;

  return {
    id: postGiftNotificationId(giftEventId, ownerId),
    dedupeKey,
    doc: {
      userId: ownerId,
      type: 'activity',
      title: `${senderName} gifted your ${contentKind}`,
      body: `${giftPhrase}${coinPhrase}${postPhrase}`,
      data: {
        type: 'post_gift',
        postId,
        giftEventId,
        giftId: String(input.giftId || ''),
        giftName,
        quantity: String(quantity),
        coinSpent: String(coins),
        actorId: senderId,
        actorUsername: senderName,
        screen: 'Feed',
      },
      dedupeKey,
      collapseKey: `post_gift:${giftEventId}`,
      status: pushEnabled ? 'queued' : 'no_device',
      sendAfter: now,
      attempts: 0,
      maxAttempts: 5,
      nextAttemptAt: 0,
      createdAt: now,
      ...(pushEnabled ? {} : { lastError: 'push_preference_disabled' }),
    },
  };
}
