type DataRecord = Record<string, any>;

export const TOPIC_NOTIFICATION_SUBCOLLECTION = 'topicNotifications';

export type TopicNotificationDecisionReason =
  | 'allowed'
  | 'topic_disabled'
  | 'global_muted'
  | 'invalid';

export interface TopicNotificationDecision {
  allowed: boolean;
  reason: TopicNotificationDecisionReason;
}

function hasExplicitFalse(values: unknown[]): boolean {
  return values.some((value) => value === false);
}

/**
 * Honor the current and legacy global preference shapes already written by
 * Blyp clients/services. Missing fields mean enabled; only an explicit false
 * mutes topic delivery.
 */
export function isGlobalNotificationMuted(...profiles: DataRecord[]): boolean {
  for (const profile of profiles) {
    if (!profile || typeof profile !== 'object') continue;
    const notificationPreferences = profile.notificationPreferences || {};
    const notificationPrefs = profile.notificationPrefs || {};
    const notifications = profile.notifications || {};
    const nested = profile.blyp?.prefs?.notifications || {};
    const preferences = profile.preferences?.notifications || {};

    if (
      hasExplicitFalse([
        profile.notificationsEnabled,
        profile.pushNotificationsEnabled,
        profile.pushNotifications,
        notificationPreferences.enabled,
        notificationPreferences.push,
        notificationPreferences.topics,
        notificationPreferences.sports,
        notificationPrefs.enabled,
        notificationPrefs.push,
        notificationPrefs.topics,
        notificationPrefs.sports,
        notifications.enabled,
        notifications.push,
        notifications.topics,
        notifications.sports,
        nested.enabled,
        nested.push,
        nested.topics,
        nested.sports,
        preferences.enabled,
        preferences.push,
        preferences.topics,
        preferences.sports,
      ])
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Authoritative check immediately before FCM. This closes the race where a
 * user turns a topic off after an event was queued but before a retry sends.
 */
export async function getTopicNotificationDecision(
  db: FirebaseFirestore.Firestore,
  userIdValue: string,
  topicIdValue: string
): Promise<TopicNotificationDecision> {
  const userId = String(userIdValue || '').trim();
  const topicId = String(topicIdValue || '').trim().toLowerCase();
  if (!userId || userId.includes('/') || !/^[a-z0-9_-]{1,64}$/.test(topicId)) {
    return { allowed: false, reason: 'invalid' };
  }

  const userRef = db.collection('users').doc(userId);
  const preferenceRef = userRef.collection(TOPIC_NOTIFICATION_SUBCOLLECTION).doc(topicId);
  const profileRef = db.collection('userProfiles').doc(userId);
  const [preferenceSnap, userSnap, profileSnap] = await db.getAll(
    preferenceRef,
    userRef,
    profileRef
  );

  const preference = preferenceSnap.data() as DataRecord | undefined;
  if (
    !preferenceSnap.exists ||
    preference?.enabled !== true ||
    String(preference?.topicId || '').toLowerCase() !== topicId ||
    String(preference?.userId || '') !== userId
  ) {
    return { allowed: false, reason: 'topic_disabled' };
  }

  if (
    isGlobalNotificationMuted(
      (userSnap.data() as DataRecord | undefined) || {},
      (profileSnap.data() as DataRecord | undefined) || {}
    )
  ) {
    return { allowed: false, reason: 'global_muted' };
  }

  return { allowed: true, reason: 'allowed' };
}
