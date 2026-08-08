"use strict";
/**
 * Trusted topic-event fan-out.
 *
 * There is no server-side sport feed ingestor in this repository yet. A trusted
 * backend/provider adapter can write real, source-attributed events to
 * topicEvents/{id}; this trigger validates the event type, finds explicit user
 * opt-ins, re-checks global/topic mutes, and uses the durable notification
 * outbox. Client writes to topicEvents are denied by Firestore rules.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.onTopicEventCreate = exports.SPORT_TOPIC_EVENT_TYPES = void 0;
exports.isSupportedTopicEventType = isSupportedTopicEventType;
exports.normalizeTopicEvent = normalizeTopicEvent;
exports.buildTopicNotification = buildTopicNotification;
exports.fanOutTopicEvent = fanOutTopicEvent;
const functions = __importStar(require("firebase-functions"));
const firebaseAdmin_1 = require("../firebaseAdmin");
const outbox_1 = require("./outbox");
const topicPreferences_1 = require("./topicPreferences");
const SUBSCRIPTION_PAGE_SIZE = 500;
const FANOUT_CONCURRENCY = 25;
exports.SPORT_TOPIC_EVENT_TYPES = {
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
function cleanText(value, maxLength) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text)
        return '';
    return text.length <= maxLength ? text : text.slice(0, maxLength).trimEnd();
}
function normalizeTopicId(value) {
    const topicId = String(value || '').trim().toLowerCase();
    return /^[a-z0-9_-]{1,64}$/.test(topicId) ? topicId : '';
}
function normalizeEventType(value) {
    const eventType = String(value || '').trim().toLowerCase();
    return /^[a-z0-9_]{1,64}$/.test(eventType) ? eventType : '';
}
function isSupportedTopicEventType(topicId, eventType) {
    const sportTypes = Object.prototype.hasOwnProperty.call(exports.SPORT_TOPIC_EVENT_TYPES, topicId)
        ? exports.SPORT_TOPIC_EVENT_TYPES[topicId]
        : null;
    if (sportTypes)
        return sportTypes.includes(eventType);
    return GENERIC_TOPIC_EVENT_TYPES.includes(eventType);
}
function normalizeTopicEvent(raw) {
    const input = (raw && typeof raw === 'object' ? raw : {});
    const topicId = normalizeTopicId(input.topicId);
    if (!topicId)
        return { event: null, reason: 'invalid_topic' };
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
    if (!title || !body)
        return { event: null, reason: 'missing_copy' };
    const data = {};
    const rawData = input.data && typeof input.data === 'object'
        ? input.data
        : {};
    for (const key of SAFE_EVENT_DATA_KEYS) {
        const value = cleanText(rawData[key], 180);
        if (value)
            data[key] = value;
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
function buildTopicNotification(topicEventId, userId, event) {
    return {
        userId,
        type: 'topic',
        title: event.title,
        body: event.body,
        dedupeKey: `topic:${event.topicId}:${event.source}:${event.sourceEventId}:` +
            `${event.eventType}:${userId}`,
        collapseKey: `topic:${event.topicId}:${event.sourceEventId}`.slice(0, 180),
        data: Object.assign({ type: 'topic_event', topicId: event.topicId, eventType: event.eventType, topicEventId, source: event.source, sourceEventId: event.sourceEventId, pageKey: `topic:${event.topicId}` }, event.data),
    };
}
async function loadTopicSubscriptions(db, topicId) {
    const subscriptions = [];
    let cursor = null;
    while (true) {
        let query = db
            .collectionGroup(topicPreferences_1.TOPIC_NOTIFICATION_SUBCOLLECTION)
            .where('topicId', '==', topicId)
            .limit(SUBSCRIPTION_PAGE_SIZE);
        if (cursor)
            query = query.startAfter(cursor);
        // eslint-disable-next-line no-await-in-loop
        const page = await query.get();
        subscriptions.push(...page.docs);
        if (page.size < SUBSCRIPTION_PAGE_SIZE)
            break;
        cursor = page.docs[page.docs.length - 1];
    }
    return subscriptions;
}
async function fanOutTopicEvent(db, topicEventId, event) {
    const subscriptions = await loadTopicSubscriptions(db, event.topicId);
    const enabled = subscriptions
        .map((snapshot) => {
        const data = snapshot.data();
        const userRef = snapshot.ref.parent.parent;
        const userId = String((userRef === null || userRef === void 0 ? void 0 : userRef.id) || '').trim();
        const structurallyValid = !!userRef &&
            userRef.parent.id === 'users' &&
            snapshot.id === event.topicId &&
            (data === null || data === void 0 ? void 0 : data.enabled) === true &&
            String((data === null || data === void 0 ? void 0 : data.topicId) || '').toLowerCase() === event.topicId &&
            (data === null || data === void 0 ? void 0 : data.userId) === userId &&
            !!userId &&
            !userId.includes('/');
        return structurallyValid ? userId : '';
    })
        .filter(Boolean);
    const uniqueUserIds = Array.from(new Set(enabled));
    const stats = {
        subscriptions: subscriptions.length,
        enabledSubscriptions: uniqueUserIds.length,
        muted: 0,
        enqueued: 0,
        duplicate: 0,
    };
    for (let i = 0; i < uniqueUserIds.length; i += FANOUT_CONCURRENCY) {
        const chunk = uniqueUserIds.slice(i, i + FANOUT_CONCURRENCY);
        // eslint-disable-next-line no-await-in-loop
        const results = await Promise.all(chunk.map(async (userId) => {
            const decision = await (0, topicPreferences_1.getTopicNotificationDecision)(db, userId, event.topicId);
            if (!decision.allowed)
                return 'muted';
            const created = await (0, outbox_1.enqueueNotification)(buildTopicNotification(topicEventId, userId, event));
            return created ? 'enqueued' : 'duplicate';
        }));
        for (const result of results)
            stats[result] += 1;
    }
    return stats;
}
exports.onTopicEventCreate = functions
    .runWith({ memory: '512MB', timeoutSeconds: 540 })
    .firestore.document('topicEvents/{topicEventId}')
    .onCreate(async (snapshot, context) => {
    (0, firebaseAdmin_1.initFirebaseAdmin)();
    const validation = normalizeTopicEvent(snapshot.data());
    if (!validation.event) {
        await snapshot.ref.set({
            notificationFanout: {
                status: 'ignored',
                reason: validation.reason || 'invalid_event',
                processedAt: firebaseAdmin_1.admin.firestore.FieldValue.serverTimestamp(),
            },
        }, { merge: true });
        console.warn(`[topicEvents] ignored ${context.params.topicEventId}: ` +
            `${validation.reason || 'invalid_event'}`);
        return null;
    }
    const stats = await fanOutTopicEvent(firebaseAdmin_1.admin.firestore(), context.params.topicEventId, validation.event);
    await snapshot.ref.set({
        notificationFanout: Object.assign(Object.assign({ status: 'processed', topicId: validation.event.topicId, eventType: validation.event.eventType }, stats), { processedAt: firebaseAdmin_1.admin.firestore.FieldValue.serverTimestamp() }),
    }, { merge: true });
    console.log(`[topicEvents] ${context.params.topicEventId}: ` +
        `enqueued=${stats.enqueued} muted=${stats.muted} duplicate=${stats.duplicate}`);
    return null;
});
//# sourceMappingURL=topicEvents.js.map