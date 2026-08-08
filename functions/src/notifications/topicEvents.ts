/**
 * Trusted topic-event fan-out.
 *
 * There is no server-side sport feed ingestor in this repository yet. A trusted
 * backend/provider adapter can write real, source-attributed events to
 * topicEvents/{id}; this trigger validates the event type, finds explicit user
 * opt-ins, re-checks global/topic mutes, and uses the durable notification
 * outbox. Client writes to topicEvents are denied by Firestore rules.
 */

import * as functions from 'firebase-functions';
import { admin, initFirebaseAdmin } from '../firebaseAdmin';
import { enqueueNotification, EnqueueInput } from './outbox';
import {
  getTopicNotificationDecision,
  TOPIC_NOTIFICATION_SUBCOLLECTION,
} from './topicPreferences';

const SUBSCRIPTION_PAGE_SIZE = 500;
const FANOUT_CONCURRENCY = 25;

export const SPORT_TOPIC_EVENT_TYPES: Record<string, readonly string[]> = {
  football: ['match_start', 'goal', 'result'],
  f1: ['race_start', 'qualifying_result', 'race_result', 'dnf'],
};

const GENERIC_TOPIC_EVENT_TYPES = ['update'];
const SAFE_EVENT_DATA_KEYS = [
  'matchId',
  'raceId',
  'teamId',
  'constructorId',
  'competitionId',
  'sessionId',
];

export interface NormalizedTopicEvent {
  topicId: string;
  eventType: string;
  source: string;
  sourceEventId: string;
  title: string;
  body: string;
  data: Record<string, string>;
}

export interface TopicEventValidation {
  event: NormalizedTopicEvent | null;
  reason?: string;
}

export interface TopicEventFanoutStats {
  subscriptions: number;
  enabledSubscriptions: number;
  muted: number;
  enqueued: number;
  duplicate: number;
}

function cleanText(value: unknown, maxLength: number): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length <= maxLength ? text : text.slice(0, maxLength).trimEnd();
}

function normalizeTopicId(value: unknown): string {
  const topicId = String(value || '').trim().toLowerCase();
  return /^[a-z0-9_-]{1,64}$/.test(topicId) ? topicId : '';
}

function normalizeEventType(value: unknown): string {
  const eventType = String(value || '').trim().toLowerCase();
  return /^[a-z0-9_]{1,64}$/.test(eventType) ? eventType : '';
}

export function isSupportedTopicEventType(topicId: string, eventType: string): boolean {
  const sportTypes = Object.prototype.hasOwnProperty.call(
    SPORT_TOPIC_EVENT_TYPES,
    topicId
  )
    ? SPORT_TOPIC_EVENT_TYPES[topicId]
    : null;
  if (sportTypes) return sportTypes.includes(eventType);
  return GENERIC_TOPIC_EVENT_TYPES.includes(eventType);
}

export function normalizeTopicEvent(raw: unknown): TopicEventValidation {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const topicId = normalizeTopicId(input.topicId);
  if (!topicId) return { event: null, reason: 'invalid_topic' };

  const eventType = normalizeEventType(input.eventType);
  if (!eventType || !isSupportedTopicEventType(topicId, eventType)) {
    return { event: null, reason: 'unsupported_event_type' };
  }

  const source = cleanText(input.source, 80);
  const sourceEventId = cleanText(input.sourceEventId, 160);
  if (!source || !sourceEventId) {
    return { event: null, reason: 'missing_source_attribution' };
  }

  const title = cleanText(input.title, 100);
  const body = cleanText(input.body, 240);
  if (!title || !body) return { event: null, reason: 'missing_copy' };

  const data: Record<string, string> = {};
  const rawData =
    input.data && typeof input.data === 'object'
      ? (input.data as Record<string, unknown>)
      : {};
  for (const key of SAFE_EVENT_DATA_KEYS) {
    const value = cleanText(rawData[key], 180);
    if (value) data[key] = value;
  }

  return {
    event: {
      topicId,
      eventType,
      source,
      sourceEventId,
      title,
      body,
      data,
    },
  };
}

export function buildTopicNotification(
  topicEventId: string,
  userId: string,
  event: NormalizedTopicEvent
): EnqueueInput {
  return {
    userId,
    type: 'topic',
    title: event.title,
    body: event.body,
    dedupeKey:
      `topic:${event.topicId}:${event.source}:${event.sourceEventId}:` +
      `${event.eventType}:${userId}`,
    collapseKey: `topic:${event.topicId}:${event.sourceEventId}`.slice(0, 180),
    data: {
      type: 'topic_event',
      topicId: event.topicId,
      eventType: event.eventType,
      topicEventId,
      source: event.source,
      sourceEventId: event.sourceEventId,
      pageKey: `topic:${event.topicId}`,
      ...event.data,
    },
  };
}

async function loadTopicSubscriptions(
  db: FirebaseFirestore.Firestore,
  topicId: string
): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
  const subscriptions: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;

  while (true) {
    let query: FirebaseFirestore.Query = db
      .collectionGroup(TOPIC_NOTIFICATION_SUBCOLLECTION)
      .where('topicId', '==', topicId)
      .limit(SUBSCRIPTION_PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);

    // eslint-disable-next-line no-await-in-loop
    const page = await query.get();
    subscriptions.push(...page.docs);
    if (page.size < SUBSCRIPTION_PAGE_SIZE) break;
    cursor = page.docs[page.docs.length - 1];
  }

  return subscriptions;
}

export async function fanOutTopicEvent(
  db: FirebaseFirestore.Firestore,
  topicEventId: string,
  event: NormalizedTopicEvent
): Promise<TopicEventFanoutStats> {
  const subscriptions = await loadTopicSubscriptions(db, event.topicId);
  const enabled = subscriptions
    .map((snapshot) => {
      const data = snapshot.data() as Record<string, any>;
      const userRef = snapshot.ref.parent.parent;
      const userId = String(userRef?.id || '').trim();
      const structurallyValid =
        !!userRef &&
        userRef.parent.id === 'users' &&
        snapshot.id === event.topicId &&
        data?.enabled === true &&
        String(data?.topicId || '').toLowerCase() === event.topicId &&
        data?.userId === userId &&
        !!userId &&
        !userId.includes('/');
      return structurallyValid ? userId : '';
    })
    .filter(Boolean);

  const uniqueUserIds = Array.from(new Set(enabled));
  const stats: TopicEventFanoutStats = {
    subscriptions: subscriptions.length,
    enabledSubscriptions: uniqueUserIds.length,
    muted: 0,
    enqueued: 0,
    duplicate: 0,
  };

  for (let i = 0; i < uniqueUserIds.length; i += FANOUT_CONCURRENCY) {
    const chunk = uniqueUserIds.slice(i, i + FANOUT_CONCURRENCY);
    // eslint-disable-next-line no-await-in-loop
    const results = await Promise.all(
      chunk.map(async (userId) => {
        const decision = await getTopicNotificationDecision(
          db,
          userId,
          event.topicId
        );
        if (!decision.allowed) return 'muted' as const;
        const created = await enqueueNotification(
          buildTopicNotification(topicEventId, userId, event)
        );
        return created ? ('enqueued' as const) : ('duplicate' as const);
      })
    );
    for (const result of results) stats[result] += 1;
  }

  return stats;
}

export const onTopicEventCreate = functions
  .runWith({ memory: '512MB', timeoutSeconds: 540 })
  .firestore.document('topicEvents/{topicEventId}')
  .onCreate(async (snapshot, context) => {
    initFirebaseAdmin();
    const validation = normalizeTopicEvent(snapshot.data());
    if (!validation.event) {
      await snapshot.ref.set(
        {
          notificationFanout: {
            status: 'ignored',
            reason: validation.reason || 'invalid_event',
            processedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        },
        { merge: true }
      );
      console.warn(
        `[topicEvents] ignored ${context.params.topicEventId}: ` +
          `${validation.reason || 'invalid_event'}`
      );
      return null;
    }

    const stats = await fanOutTopicEvent(
      admin.firestore(),
      context.params.topicEventId,
      validation.event
    );
    await snapshot.ref.set(
      {
        notificationFanout: {
          status: 'processed',
          topicId: validation.event.topicId,
          eventType: validation.event.eventType,
          ...stats,
          processedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      },
      { merge: true }
    );
    console.log(
      `[topicEvents] ${context.params.topicEventId}: ` +
        `enqueued=${stats.enqueued} muted=${stats.muted} duplicate=${stats.duplicate}`
    );
    return null;
  });
