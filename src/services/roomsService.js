// roomsService — client data layer for hostless, topic-based group video rooms.
//
// Mirrors the battleService split: Firestore is read in real time for discovery
// + presence, while every authoritative action (claim seat, leave) goes through
// the live-service (see ivsLiveApi room functions) so capacity stays server-side.
//
// Rooms are SEEDED by the backend (listRooms() triggers ensureSeedRooms). After
// that the `rooms` collection can be subscribed to directly for live counts.
//
// Degrades gracefully: no Firebase -> realtime subscriptions are no-ops and the
// screens fall back to the backend snapshot.

import { db, firebaseEnabled } from '../config/firebase';
import { INTEREST_CATALOG } from './userPreferencesService';
import {
  listRooms as apiListRooms,
  joinRoomAsPublisher as apiJoinPublisher,
  joinRoomAsViewer as apiJoinViewer,
  leaveRoom as apiLeaveRoom,
  roomHeartbeat as apiRoomHeartbeat,
} from '../api/ivsLiveApi';

const ROOMS = 'rooms';

/** Topic catalogue reused from the app's interest vocabulary. */
export function getTopics() {
  return INTEREST_CATALOG;
}

const topicMeta = new Map(INTEREST_CATALOG.map((t) => [t.id, t]));

export function topicIconFor(topicId) {
  return topicMeta.get(topicId)?.icon || 'pricetag';
}

function publisherCountOf(data) {
  if (typeof data?.publisherCount === 'number') return data.publisherCount;
  const occupied = data?.occupiedSlots || {};
  return Object.keys(occupied).length;
}

function mapRoom(id, data) {
  const capacity = Number(data?.capacity) || 0;
  const publisherCount = publisherCountOf(data);
  return {
    roomId: data?.roomId || id,
    topicId: data?.topicId || 'other',
    topicLabel: data?.topicLabel || 'Other',
    title: data?.title || 'Room',
    capacity,
    publisherCount,
    isFull: capacity > 0 && publisherCount >= capacity,
    isActive: data?.isActive !== false,
    hasStage: !!data?.stageArn,
  };
}

/**
 * Group a flat room list into topic sections, ordered by the interest catalogue
 * so the browse screen feels consistent with the rest of the app.
 */
export function groupRoomsByTopic(rooms) {
  const byTopic = new Map();
  for (const room of rooms || []) {
    if (!byTopic.has(room.topicId)) byTopic.set(room.topicId, []);
    byTopic.get(room.topicId).push(room);
  }
  const sections = [];
  // Catalogue order first.
  for (const topic of INTEREST_CATALOG) {
    const items = byTopic.get(topic.id);
    if (items && items.length) {
      sections.push({ topicId: topic.id, topicLabel: topic.label, icon: topic.icon, rooms: items });
      byTopic.delete(topic.id);
    }
  }
  // Any topics not in the catalogue, appended.
  for (const [topicId, items] of byTopic.entries()) {
    sections.push({ topicId, topicLabel: items[0]?.topicLabel || topicId, icon: 'pricetag', rooms: items });
  }
  return sections;
}

/** One-shot backend fetch. Also seeds rooms server-side on first call. */
export async function fetchRooms() {
  try {
    return await apiListRooms();
  } catch (e) {
    console.warn('[roomsService] fetchRooms failed', e?.message || e);
    return [];
  }
}

/** Realtime subscription to the active rooms list (live publisher counts). */
export function subscribeRooms(cb) {
  if (!firebaseEnabled || !db?.collection) {
    cb([]);
    return () => {};
  }
  try {
    return db
      .collection(ROOMS)
      .where('isActive', '==', true)
      .limit(300)
      .onSnapshot(
        (snap) => {
          const rows = (snap?.docs || []).map((d) => mapRoom(d.id, d.data()));
          cb(rows);
        },
        () => cb([])
      );
  } catch {
    cb([]);
    return () => {};
  }
}

/** Realtime subscription to a single room document. */
export function subscribeRoom(roomId, cb) {
  if (!firebaseEnabled || !db?.collection || !roomId) {
    cb(null);
    return () => {};
  }
  try {
    return db
      .collection(ROOMS)
      .doc(roomId)
      .onSnapshot(
        (snap) => {
          const data = typeof snap?.data === 'function' ? snap.data() : null;
          cb(data ? mapRoom(roomId, data) : null);
        },
        () => cb(null)
      );
  } catch {
    cb(null);
    return () => {};
  }
}

/** Realtime subscription to a room's participant presence rows. */
export function subscribeRoomParticipants(roomId, cb) {
  if (!firebaseEnabled || !db?.collection || !roomId) {
    cb([]);
    return () => {};
  }
  try {
    return db
      .collection(ROOMS)
      .doc(roomId)
      .collection('participants')
      .onSnapshot(
        (snap) => {
          const rows = (snap?.docs || []).map((d) => ({ uid: d.id, ...d.data() }));
          cb(rows);
        },
        () => cb([])
      );
  } catch {
    cb([]);
    return () => {};
  }
}

// Authoritative actions (live-service).
export const joinRoomAsPublisher = apiJoinPublisher;
export const joinRoomAsViewer = apiJoinViewer;
export const leaveRoom = apiLeaveRoom;
export const roomHeartbeat = apiRoomHeartbeat;

export default {
  getTopics,
  topicIconFor,
  groupRoomsByTopic,
  fetchRooms,
  subscribeRooms,
  subscribeRoom,
  subscribeRoomParticipants,
  joinRoomAsPublisher,
  joinRoomAsViewer,
  leaveRoom,
  roomHeartbeat,
};
