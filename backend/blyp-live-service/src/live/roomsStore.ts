// roomsStore — Firestore data layer for hostless, topic-based group video rooms.
//
// A "room" is a persistent, public, hostless space where any user can claim an
// open seat and publish their own camera/mic to a SHARED IVS real-time stage
// (the same open-publish model as battle co-hosts, generalised to N seats).
//
// Firestore is the source of truth so clients can subscribe in real time, but
// every slot CLAIM goes through the backend (Admin SDK, which bypasses security
// rules) inside a transaction — that is what makes capacity authoritative and
// prevents two users grabbing the last seat at once.
//
// Data model:
//   rooms/{roomId}
//     roomId, topicId, topicLabel, title, capacity,
//     createdAt, updatedAt, isActive,
//     stageArn, sessionId,                 // IVS real-time stage (lazy-created)
//     stageProvisioningAt,                 // short-lived lock while creating stage
//     publisherCount,                      // derived count of active publishers
//     occupiedSlots: { "<slotIndex>": uid } // authoritative compact seat map
//   rooms/{roomId}/participants/{uid}
//     uid, role: 'participant' | 'viewer', publishing, slotIndex,
//     displayName, joinedAt, lastSeenAt

import { getFirestore } from '../admin/firestoreAdmin';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { logger } from '../config/logger';

export const DEFAULT_ROOM_CAPACITY = Number(process.env.ROOM_CAPACITY) || 8;
export const ROOM_STAGE_PROVISION_LOCK_MS = 15_000;
export const ROOM_PRESENCE_TTL_MS = Number(process.env.ROOM_PRESENCE_TTL_MS) || 45_000;

export interface RoomDoc {
  roomId: string;
  topicId: string;
  topicLabel: string;
  title: string;
  capacity: number;
  isActive: boolean;
  stageArn?: string | null;
  sessionId?: string | null;
  stageProvisioningAt?: number | null;
  publisherCount?: number;
  occupiedSlots?: Record<string, string>;
  createdAt?: number;
  updatedAt?: number;
}

export interface RoomParticipantDoc {
  uid: string;
  role: 'participant' | 'viewer';
  publishing: boolean;
  slotIndex: number | null;
  displayName?: string;
  joinedAt?: number;
  lastSeenAt?: number;
}

function db(): Firestore {
  const fs = getFirestore();
  if (!fs) {
    const err: any = new Error('Firestore is not available');
    err.code = 'FIRESTORE_UNAVAILABLE';
    throw err;
  }
  return fs;
}

function roomRef(roomId: string) {
  return db().collection('rooms').doc(roomId);
}

function participantsCol(roomId: string) {
  return roomRef(roomId).collection('participants');
}

function now(): number {
  return Date.now();
}

// ---------------------------------------------------------------------------
// Seeding — define an initial set of topic rooms so the browse screen has
// something to show. Idempotent: only creates rooms that don't already exist.
// Topic ids mirror the client INTEREST_CATALOG so rooms slot into the app's
// existing topic vocabulary.
// ---------------------------------------------------------------------------

export interface SeedRoomSpec {
  roomId: string;
  topicId: string;
  topicLabel: string;
  title: string;
  capacity?: number;
}

export const SEED_ROOMS: SeedRoomSpec[] = [
  { roomId: 'football-banter', topicId: 'football', topicLabel: 'Football', title: 'Match Day Banter' },
  { roomId: 'football-transfers', topicId: 'football', topicLabel: 'Football', title: 'Transfer Talk' },
  { roomId: 'f1-paddock', topicId: 'f1', topicLabel: 'Formula 1', title: 'Paddock Club' },
  { roomId: 'gaming-lobby', topicId: 'gaming', topicLabel: 'Gaming', title: 'The Lobby' },
  { roomId: 'gaming-speedruns', topicId: 'gaming', topicLabel: 'Gaming', title: 'Speedrun Couch' },
  { roomId: 'music-listening-party', topicId: 'music', topicLabel: 'Music', title: 'Listening Party' },
  { roomId: 'comedy-open-mic', topicId: 'comedy', topicLabel: 'Comedy', title: 'Open Mic Night' },
  { roomId: 'cooking-kitchen', topicId: 'cooking', topicLabel: 'Food & Cooking', title: 'Whats Cooking' },
  { roomId: 'tech-founders', topicId: 'tech', topicLabel: 'Tech', title: 'Build in Public' },
  { roomId: 'finance-markets', topicId: 'finance', topicLabel: 'Money & Crypto', title: 'Markets Open' },
  { roomId: 'travel-backpackers', topicId: 'travel', topicLabel: 'Travel', title: 'Backpacker Lounge' },
  { roomId: 'fitness-gymfloor', topicId: 'fitness', topicLabel: 'Fitness', title: 'Gym Floor' },
];

let seedEnsured = false;

export async function ensureSeedRooms(): Promise<void> {
  if (seedEnsured) return;
  const fs = db();
  const batch = fs.batch();
  let writes = 0;

  for (const spec of SEED_ROOMS) {
    const ref = fs.collection('rooms').doc(spec.roomId);
    const snap = await ref.get();
    if (snap.exists) continue;
    batch.set(ref, {
      roomId: spec.roomId,
      topicId: spec.topicId,
      topicLabel: spec.topicLabel,
      title: spec.title,
      capacity: spec.capacity ?? DEFAULT_ROOM_CAPACITY,
      isActive: true,
      stageArn: null,
      sessionId: null,
      stageProvisioningAt: null,
      publisherCount: 0,
      occupiedSlots: {},
      createdAt: now(),
      updatedAt: now(),
    } satisfies RoomDoc);
    writes += 1;
  }

  if (writes > 0) {
    await batch.commit();
    logger.info({ writes }, '[rooms] seeded topic rooms');
  }
  seedEnsured = true;
}

export async function getRoom(roomId: string): Promise<RoomDoc | null> {
  const snap = await roomRef(roomId).get();
  if (!snap.exists) return null;
  return snap.data() as RoomDoc;
}

export async function listActiveRooms(): Promise<RoomDoc[]> {
  const snap = await db().collection('rooms').where('isActive', '==', true).limit(300).get();
  return snap.docs.map((d) => d.data() as RoomDoc);
}

// ---------------------------------------------------------------------------
// Stage provisioning lock — the IVS CreateStage call is an external AWS request
// and cannot run inside a Firestore transaction, so we use a short-lived lock to
// make sure only ONE concurrent joiner provisions the stage for an empty room.
// ---------------------------------------------------------------------------

export type StageLockResult =
  | { action: 'have'; stageArn: string; sessionId: string }
  | { action: 'wait' }
  | { action: 'create' };

export async function acquireStageProvisioningLock(roomId: string): Promise<StageLockResult> {
  const fs = db();
  return fs.runTransaction(async (tx) => {
    const ref = roomRef(roomId);
    const snap = await tx.get(ref);
    if (!snap.exists) {
      const err: any = new Error('Room not found');
      err.code = 'ROOM_NOT_FOUND';
      throw err;
    }
    const room = snap.data() as RoomDoc;
    if (room.stageArn && room.sessionId && room.isActive) {
      return { action: 'have', stageArn: room.stageArn, sessionId: room.sessionId };
    }
    const lockAt = room.stageProvisioningAt || 0;
    if (lockAt && now() - lockAt < ROOM_STAGE_PROVISION_LOCK_MS) {
      return { action: 'wait' };
    }
    tx.update(ref, { stageProvisioningAt: now(), updatedAt: now() });
    return { action: 'create' };
  });
}

export async function setRoomStage(roomId: string, stageArn: string, sessionId: string): Promise<void> {
  await roomRef(roomId).update({
    stageArn,
    sessionId,
    isActive: true,
    stageProvisioningAt: null,
    updatedAt: now(),
  });
}

export async function clearStageProvisioningLock(roomId: string): Promise<void> {
  try {
    await roomRef(roomId).update({ stageProvisioningAt: null, updatedAt: now() });
  } catch {
    // best-effort
  }
}

// ---------------------------------------------------------------------------
// Slot claiming — authoritative, transaction-guarded seat allocation.
// ---------------------------------------------------------------------------

function firstFreeSlot(occupied: Record<string, string>, capacity: number): number | null {
  for (let i = 1; i <= capacity; i += 1) {
    if (!occupied[String(i)]) return i;
  }
  return null;
}

export interface ClaimSlotResult {
  slotIndex: number;
  alreadyPublishing: boolean;
}

/**
 * Claim an open publisher seat for a user. Runs inside a transaction so two
 * users can never grab the same last seat. Idempotent: if the user already
 * holds a seat, returns it without re-allocating.
 *
 * Throws { code: 'ROOM_FULL' } when no seat is free.
 */
export async function claimSlot(
  roomId: string,
  uid: string,
  displayName?: string,
): Promise<ClaimSlotResult> {
  const fs = db();
  return fs.runTransaction(async (tx) => {
    const rRef = roomRef(roomId);
    const pRef = participantsCol(roomId).doc(uid);
    const [roomSnap, partSnap] = await Promise.all([tx.get(rRef), tx.get(pRef)]);

    if (!roomSnap.exists) {
      const err: any = new Error('Room not found');
      err.code = 'ROOM_NOT_FOUND';
      throw err;
    }
    const room = roomSnap.data() as RoomDoc;
    const capacity = room.capacity || DEFAULT_ROOM_CAPACITY;
    const occupied: Record<string, string> = { ...(room.occupiedSlots || {}) };

    // Idempotent rejoin: user already holds a seat.
    const existing = partSnap.exists ? (partSnap.data() as RoomParticipantDoc) : null;
    if (existing && existing.publishing && typeof existing.slotIndex === 'number' && occupied[String(existing.slotIndex)] === uid) {
      tx.update(pRef, { lastSeenAt: now() });
      return { slotIndex: existing.slotIndex, alreadyPublishing: true };
    }

    const slot = firstFreeSlot(occupied, capacity);
    if (slot == null) {
      const err: any = new Error('Room is full');
      err.code = 'ROOM_FULL';
      throw err;
    }

    occupied[String(slot)] = uid;
    tx.update(rRef, {
      occupiedSlots: occupied,
      publisherCount: Object.keys(occupied).length,
      updatedAt: now(),
    });
    tx.set(pRef, {
      uid,
      role: 'participant',
      publishing: true,
      slotIndex: slot,
      displayName: displayName || uid,
      joinedAt: now(),
      lastSeenAt: now(),
    } satisfies RoomParticipantDoc);

    return { slotIndex: slot, alreadyPublishing: false };
  });
}

/** Register (or refresh) a viewer presence row. Viewers never consume a seat. */
export async function addViewer(roomId: string, uid: string, displayName?: string): Promise<void> {
  const pRef = participantsCol(roomId).doc(uid);
  const snap = await pRef.get();
  // Don't downgrade an active publisher to viewer.
  if (snap.exists && (snap.data() as RoomParticipantDoc).publishing) {
    await pRef.update({ lastSeenAt: now() });
    return;
  }
  await pRef.set({
    uid,
    role: 'viewer',
    publishing: false,
    slotIndex: null,
    displayName: displayName || uid,
    joinedAt: snap.exists ? (snap.data() as RoomParticipantDoc).joinedAt || now() : now(),
    lastSeenAt: now(),
  } satisfies RoomParticipantDoc);
}

/** Free a user's seat (if any) and remove their presence row. Transaction-safe. */
export async function releaseSlot(roomId: string, uid: string): Promise<void> {
  const fs = db();
  await fs.runTransaction(async (tx) => {
    const rRef = roomRef(roomId);
    const pRef = participantsCol(roomId).doc(uid);
    const [roomSnap, partSnap] = await Promise.all([tx.get(rRef), tx.get(pRef)]);
    if (roomSnap.exists && partSnap.exists) {
      const room = roomSnap.data() as RoomDoc;
      const part = partSnap.data() as RoomParticipantDoc;
      const occupied: Record<string, string> = { ...(room.occupiedSlots || {}) };
      if (typeof part.slotIndex === 'number' && occupied[String(part.slotIndex)] === uid) {
        delete occupied[String(part.slotIndex)];
        tx.update(rRef, {
          occupiedSlots: occupied,
          publisherCount: Object.keys(occupied).length,
          updatedAt: now(),
        });
      }
    }
    if (partSnap.exists) tx.delete(pRef);
  });
}

export async function heartbeat(roomId: string, uid: string): Promise<void> {
  await participantsCol(roomId).doc(uid).update({ lastSeenAt: now() }).catch(() => {
    // If the row is gone (swept/left), ignore — caller can re-join.
  });
}

// ---------------------------------------------------------------------------
// Stale presence sweeper — reclaims seats from clients that died without a
// graceful leave (crash, force-quit, lost network). Recomputes occupiedSlots
// from surviving publisher rows so the authoritative seat map self-heals.
// ---------------------------------------------------------------------------

export async function sweepStaleParticipants(roomId: string, ttlMs = ROOM_PRESENCE_TTL_MS): Promise<number> {
  const fs = db();
  const cutoff = now() - ttlMs;
  const stale = await participantsCol(roomId).where('lastSeenAt', '<', cutoff).get();
  if (stale.empty) return 0;

  return fs.runTransaction(async (tx) => {
    const rRef = roomRef(roomId);
    const roomSnap = await tx.get(rRef);
    if (!roomSnap.exists) return 0;
    const room = roomSnap.data() as RoomDoc;
    const occupied: Record<string, string> = { ...(room.occupiedSlots || {}) };
    let removed = 0;

    for (const docSnap of stale.docs) {
      const part = docSnap.data() as RoomParticipantDoc;
      // Re-read under the transaction window guard: only sweep rows still stale.
      if ((part.lastSeenAt || 0) >= cutoff) continue;
      if (typeof part.slotIndex === 'number' && occupied[String(part.slotIndex)] === part.uid) {
        delete occupied[String(part.slotIndex)];
      }
      tx.delete(docSnap.ref);
      removed += 1;
    }

    if (removed > 0) {
      tx.update(rRef, {
        occupiedSlots: occupied,
        publisherCount: Object.keys(occupied).length,
        updatedAt: now(),
      });
    }
    return removed;
  });
}
