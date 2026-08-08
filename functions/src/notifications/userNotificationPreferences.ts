/**
 * Global + per-person notification preferences.
 *
 * Precedence (first match wins):
 *   1. Master push off (new settings or legacy profile flags) → deny
 *   2. Per-person override for the notification actor:
 *        mode "everything" → allow (topics still need topic opt-in)
 *        mode "nothing"    → deny
 *        mode "custom"     → explicit category bool if set, else fall through
 *   3. Global category toggle (defaults below when unset)
 *   4. Topic events additionally require users/{uid}/topicNotifications/{topicId}
 *
 * Per-person beats global wherever an override is set. Missing docs = defaults
 * (non-spammy: core chat/live/calls on; streak/social/dating off).
 */

import { isGlobalNotificationMuted } from './topicPreferences';
import { NotificationType } from './types';

export const NOTIFICATION_SETTINGS_DOC = 'global';
export const NOTIFICATION_SETTINGS_SUBCOLLECTION = 'notificationSettings';
export const NOTIFICATION_OVERRIDES_SUBCOLLECTION = 'notificationOverrides';

export const NOTIFICATION_CATEGORIES = [
  'live',
  'message',
  'battle',
  'team',
  'call',
  'gift',
  'presence',
  'streak',
  'system',
  'topic',
  'follow',
  'social',
  'dating',
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
export type OverrideMode = 'custom' | 'everything' | 'nothing';

export type CategoryMap = Partial<Record<NotificationCategory, boolean>>;

export interface GlobalNotificationSettings {
  userId?: string;
  pushEnabled?: boolean;
  categories?: CategoryMap;
  updatedAt?: number;
}

export interface PersonNotificationOverride {
  userId?: string;
  targetUid?: string;
  mode?: OverrideMode;
  categories?: CategoryMap;
  updatedAt?: number;
}

export type PushDecisionReason =
  | 'allowed'
  | 'master_muted'
  | 'person_nothing'
  | 'person_category_off'
  | 'global_category_off'
  | 'topic_disabled'
  | 'invalid';

export interface PushNotificationDecision {
  allowed: boolean;
  reason: PushDecisionReason;
  category: NotificationCategory | null;
  actorUid: string | null;
}

type DataRecord = Record<string, any>;

/** Non-spammy defaults: important social on, marketing-ish / future off. */
export const DEFAULT_CATEGORY_ENABLED: Record<NotificationCategory, boolean> = {
  live: true,
  message: true,
  battle: true,
  team: true,
  call: true,
  gift: true,
  presence: true, // only fires after an explicit userWatch
  streak: false,
  system: true,
  topic: true, // master; each topic is still opt-in
  follow: false,
  social: false,
  dating: false,
};

const ACTOR_DATA_KEYS = [
  'actorId',
  'actorUid',
  'hostId',
  'senderId',
  'callerId',
  'fromUid',
  'requesterId',
  'gifterId',
] as const;

export function isNotificationCategory(value: unknown): value is NotificationCategory {
  return typeof value === 'string' && (NOTIFICATION_CATEGORIES as readonly string[]).includes(value);
}

export function normalizeOverrideMode(value: unknown): OverrideMode {
  if (value === 'everything' || value === 'nothing' || value === 'custom') return value;
  return 'custom';
}

export function extractActorUid(data?: Record<string, string> | null): string | null {
  if (!data || typeof data !== 'object') return null;
  for (const key of ACTOR_DATA_KEYS) {
    const raw = String((data as DataRecord)[key] || '').trim();
    if (raw && !raw.includes('/')) return raw;
  }
  return null;
}

/**
 * Map outbox type + data.type / kind onto a preference category.
 */
export function resolveNotificationCategory(
  type: NotificationType | string | undefined,
  data?: Record<string, string> | null
): NotificationCategory {
  const dataType = String(data?.type || '').trim().toLowerCase();
  const kind = String(data?.kind || '').trim().toLowerCase();
  const combined = `${dataType}|${kind}`;

  if (
    dataType === 'incoming_call' ||
    type === 'call' ||
    dataType === 'call'
  ) {
    return 'call';
  }
  if (
    dataType === 'post_gift' ||
    combined.includes('gift') ||
    dataType === 'gift'
  ) {
    return 'gift';
  }
  if (dataType === 'presence' || kind === 'presence') {
    return 'presence';
  }
  if (type === 'streak' || dataType === 'streak') {
    return 'streak';
  }
  if (
    type === 'topic' ||
    dataType === 'topic_event' ||
    dataType === 'topic'
  ) {
    return 'topic';
  }
  if (
    type === 'system' ||
    dataType === 'admin' ||
    dataType === 'tour' ||
    dataType === 'system'
  ) {
    return 'system';
  }
  if (type === 'message' || dataType === 'message' || dataType === 'dm') {
    return 'message';
  }
  if (
    type === 'battle' ||
    dataType.startsWith('battle') ||
    kind.startsWith('battle') ||
    kind === 'team_battle'
  ) {
    return 'battle';
  }
  if (
    type === 'team' ||
    dataType === 'team' ||
    dataType.startsWith('audition') ||
    kind.startsWith('audition') ||
    kind === 'join_request' ||
    kind === 'join_decision' ||
    kind === 'group_message' ||
    kind === 'team_warning'
  ) {
    return 'team';
  }
  if (
    type === 'live' ||
    dataType === 'live' ||
    dataType === 'guest_invite' ||
    dataType === 'live_start'
  ) {
    return 'live';
  }
  if (dataType === 'follow' || kind === 'follow') {
    return 'follow';
  }
  if (
    dataType === 'comment' ||
    dataType === 'like' ||
    dataType === 'social' ||
    kind === 'comment' ||
    kind === 'like'
  ) {
    return 'social';
  }
  if (dataType === 'dating' || kind === 'dating' || type === 'dating') {
    return 'dating';
  }
  if (type === 'activity') {
    return 'gift';
  }
  if (type === 'reminder') {
    return 'system';
  }
  return 'system';
}

function readExplicitBool(map: CategoryMap | undefined, category: NotificationCategory): boolean | undefined {
  if (!map || typeof map !== 'object') return undefined;
  const value = map[category];
  if (value === true) return true;
  if (value === false) return false;
  return undefined;
}

function isMasterPushDisabled(
  settings: GlobalNotificationSettings | null | undefined,
  ...profiles: DataRecord[]
): boolean {
  if (settings && settings.pushEnabled === false) return true;
  return isGlobalNotificationMuted(...profiles);
}

/**
 * Pure decision given already-loaded docs. Used by the dispatcher and unit tests.
 */
export function decidePushNotification(input: {
  userId: string;
  type?: NotificationType | string;
  data?: Record<string, string> | null;
  settings?: GlobalNotificationSettings | null;
  override?: PersonNotificationOverride | null;
  profiles?: DataRecord[];
  /** For topic events: whether the per-topic opt-in doc is enabled. */
  topicOptInEnabled?: boolean | null;
}): PushNotificationDecision {
  const userId = String(input.userId || '').trim();
  if (!userId || userId.includes('/')) {
    return { allowed: false, reason: 'invalid', category: null, actorUid: null };
  }

  const category = resolveNotificationCategory(input.type, input.data);
  const actorUid = extractActorUid(input.data);

  if (isMasterPushDisabled(input.settings, ...(input.profiles || []))) {
    return { allowed: false, reason: 'master_muted', category, actorUid };
  }

  const override = input.override;
  if (override && actorUid && String(override.targetUid || actorUid) === actorUid) {
    const mode = normalizeOverrideMode(override.mode);
    if (mode === 'everything') {
      // Topic events still require an explicit topic opt-in.
      if (category === 'topic' && input.topicOptInEnabled !== true) {
        return { allowed: false, reason: 'topic_disabled', category, actorUid };
      }
      return { allowed: true, reason: 'allowed', category, actorUid };
    }
    if (mode === 'nothing') {
      return { allowed: false, reason: 'person_nothing', category, actorUid };
    }
    const personCat = readExplicitBool(override.categories, category);
    if (personCat === false) {
      return { allowed: false, reason: 'person_category_off', category, actorUid };
    }
    if (personCat === true) {
      if (category === 'topic' && input.topicOptInEnabled !== true) {
        return { allowed: false, reason: 'topic_disabled', category, actorUid };
      }
      return { allowed: true, reason: 'allowed', category, actorUid };
    }
    // custom with unset category → fall through to global
  }

  const globalCat = readExplicitBool(input.settings?.categories, category);
  const enabled =
    globalCat === undefined ? DEFAULT_CATEGORY_ENABLED[category] === true : globalCat === true;
  if (!enabled) {
    return { allowed: false, reason: 'global_category_off', category, actorUid };
  }

  if (category === 'topic' && input.topicOptInEnabled !== true) {
    return { allowed: false, reason: 'topic_disabled', category, actorUid };
  }

  return { allowed: true, reason: 'allowed', category, actorUid };
}

async function loadTopicOptIn(
  db: FirebaseFirestore.Firestore,
  userId: string,
  topicIdValue: string
): Promise<boolean> {
  const topicId = String(topicIdValue || '').trim().toLowerCase();
  if (!topicId || !/^[a-z0-9_-]{1,64}$/.test(topicId)) return false;
  const snap = await db
    .collection('users')
    .doc(userId)
    .collection('topicNotifications')
    .doc(topicId)
    .get();
  if (!snap.exists) return false;
  const data = snap.data() as DataRecord | undefined;
  return (
    data?.enabled === true &&
    String(data?.topicId || '').toLowerCase() === topicId &&
    String(data?.userId || '') === userId
  );
}

/**
 * Authoritative check immediately before FCM (and for direct call sends).
 */
export async function getPushNotificationDecision(
  db: FirebaseFirestore.Firestore,
  input: {
    userId: string;
    type?: NotificationType | string;
    data?: Record<string, string> | null;
  }
): Promise<PushNotificationDecision> {
  const userId = String(input.userId || '').trim();
  if (!userId || userId.includes('/')) {
    return { allowed: false, reason: 'invalid', category: null, actorUid: null };
  }

  const category = resolveNotificationCategory(input.type, input.data);
  const actorUid = extractActorUid(input.data);

  const userRef = db.collection('users').doc(userId);
  const settingsRef = userRef
    .collection(NOTIFICATION_SETTINGS_SUBCOLLECTION)
    .doc(NOTIFICATION_SETTINGS_DOC);
  const profileRef = db.collection('userProfiles').doc(userId);
  const refs: FirebaseFirestore.DocumentReference[] = [settingsRef, userRef, profileRef];
  let overrideRef: FirebaseFirestore.DocumentReference | null = null;
  if (actorUid && actorUid !== userId) {
    overrideRef = userRef.collection(NOTIFICATION_OVERRIDES_SUBCOLLECTION).doc(actorUid);
    refs.push(overrideRef);
  }

  const snaps = await db.getAll(...refs);
  const settingsSnap = snaps[0];
  const userSnap = snaps[1];
  const profileSnap = snaps[2];
  const overrideSnap = overrideRef ? snaps[3] : null;

  const settings = (settingsSnap.data() as GlobalNotificationSettings | undefined) || null;
  const override = overrideSnap?.exists
    ? ((overrideSnap.data() as PersonNotificationOverride | undefined) || null)
    : null;

  let topicOptInEnabled: boolean | null = null;
  if (category === 'topic') {
    topicOptInEnabled = await loadTopicOptIn(
      db,
      userId,
      String(input.data?.topicId || '')
    );
  }

  return decidePushNotification({
    userId,
    type: input.type,
    data: input.data,
    settings,
    override:
      override && actorUid
        ? { ...override, targetUid: String(override.targetUid || actorUid) }
        : null,
    profiles: [
      (userSnap.data() as DataRecord | undefined) || {},
      (profileSnap.data() as DataRecord | undefined) || {},
    ],
    topicOptInEnabled,
  });
}
