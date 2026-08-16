"use client";

import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "./firebase";

export type ChatThread = {
  id: string;
  participantIds: string[];
  participantNames: string[];
  lastMessage: string;
  lastMessageTimeMs: number;
  unreadCount: number;
  type: string;
};

export type ChatMessage = {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  type: string;
  timestampMs: number;
};

function pickStr(...vals: unknown[]): string {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function timeMs(value: unknown): number {
  if (!value) return 0;
  if (typeof (value as { toMillis?: () => number }).toMillis === "function") {
    const n = (value as { toMillis: () => number }).toMillis();
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof (value as { toDate?: () => Date }).toDate === "function") {
    const n = (value as { toDate: () => Date }).toDate()?.getTime?.();
    return Number.isFinite(n) ? n! : 0;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  return 0;
}

function participantIds(data: Record<string, unknown>): string[] {
  const ids =
    (Array.isArray(data.participantIds) && data.participantIds) ||
    (Array.isArray(data.participants) && data.participants) ||
    [];
  return (ids as unknown[]).map((x) => String(x || "")).filter(Boolean);
}

function normalizeThread(
  id: string,
  data: Record<string, unknown>,
  uid: string,
): ChatThread {
  const unreadRaw = data.unreadCount;
  let unread = 0;
  if (unreadRaw && typeof unreadRaw === "object") {
    unread = Number((unreadRaw as Record<string, unknown>)[uid]) || 0;
  } else if (typeof unreadRaw === "number") {
    unread = unreadRaw;
  }
  const names = Array.isArray(data.participantNames)
    ? (data.participantNames as unknown[]).map((n) => String(n || ""))
    : [];
  return {
    id,
    participantIds: participantIds(data),
    participantNames: names,
    lastMessage: pickStr(data.lastMessage),
    lastMessageTimeMs: timeMs(data.lastMessageTime || data.updatedAt),
    unreadCount: unread,
    type: pickStr(data.type) || "dm",
  };
}

function normalizeMessage(
  id: string,
  data: Record<string, unknown>,
): ChatMessage {
  return {
    id,
    senderId: pickStr(data.senderId, data.uid),
    senderName: pickStr(data.senderName, data.username) || "user",
    text: pickStr(data.text, data.body, data.message),
    type: pickStr(data.type) || "text",
    timestampMs: timeMs(data.timestamp || data.createdAt),
  };
}

function sortThreads(threads: ChatThread[]): ChatThread[] {
  return [...threads].sort((a, b) => b.lastMessageTimeMs - a.lastMessageTimeMs);
}

export async function listThreads(uid: string): Promise<ChatThread[]> {
  const db = getDb();
  const q = query(
    collection(db, "conversations"),
    where("participantIds", "array-contains", uid),
  );
  const snap = await getDocs(q);
  return sortThreads(
    snap.docs
      .map((d) => normalizeThread(d.id, d.data() as Record<string, unknown>, uid))
      .filter((t) => t.participantIds.includes(uid)),
  );
}

export function subscribeThreads(
  uid: string,
  onThreads: (threads: ChatThread[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const db = getDb();
  const conversationsRef = collection(db, "conversations");
  const ordered = query(
    conversationsRef,
    where("participantIds", "array-contains", uid),
    orderBy("lastMessageTime", "desc"),
  );
  const fallback = query(
    conversationsRef,
    where("participantIds", "array-contains", uid),
  );

  const handle = (docs: { id: string; data: () => Record<string, unknown> }[]) => {
    const threads = sortThreads(
      docs
        .map((d) => normalizeThread(d.id, d.data(), uid))
        .filter((t) => t.participantIds.includes(uid)),
    );
    onThreads(threads);
  };

  let unsub: Unsubscribe | null = null;

  const useFallback = () => {
    unsub = onSnapshot(
      fallback,
      (snap) => handle(snap.docs.map((d) => ({ id: d.id, data: () => d.data() as Record<string, unknown> }))),
      (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
    );
  };

  unsub = onSnapshot(
    ordered,
    (snap) =>
      handle(
        snap.docs.map((d) => ({
          id: d.id,
          data: () => d.data() as Record<string, unknown>,
        })),
      ),
    (err) => {
      const msg = String(err?.message || err || "").toLowerCase();
      const code = String((err as { code?: string })?.code || "").toLowerCase();
      if (
        code === "failed-precondition" ||
        msg.includes("requires an index") ||
        msg.includes("index")
      ) {
        try {
          unsub?.();
        } catch {
          /* ignore */
        }
        useFallback();
        return;
      }
      onError?.(err instanceof Error ? err : new Error(String(err)));
    },
  );

  return () => {
    try {
      unsub?.();
    } catch {
      /* ignore */
    }
  };
}

export function subscribeMessages(
  conversationId: string,
  onMessages: (messages: ChatMessage[]) => void,
  onError?: (err: Error) => void,
  pageSize = 50,
): Unsubscribe {
  const db = getDb();
  const q = query(
    collection(db, "conversations", conversationId, "messages"),
    orderBy("timestamp", "desc"),
    limit(pageSize),
  );
  return onSnapshot(
    q,
    (snap) => {
      const messages = snap.docs
        .map((d) =>
          normalizeMessage(d.id, d.data() as Record<string, unknown>),
        )
        .reverse();
      onMessages(messages);
    },
    (err) => onError?.(err instanceof Error ? err : new Error(String(err))),
  );
}

export async function sendMessage(
  conversationId: string,
  senderId: string,
  senderName: string,
  text: string,
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  const db = getDb();
  const messagesRef = collection(
    db,
    "conversations",
    conversationId,
    "messages",
  );
  const conversationRef = doc(db, "conversations", conversationId);

  await addDoc(messagesRef, {
    senderId,
    senderName,
    text: trimmed,
    type: "text",
    createdAt: serverTimestamp(),
    timestamp: serverTimestamp(),
    status: "sent",
  });

  let participants: string[] = [];
  try {
    const snap = await getDoc(conversationRef);
    if (snap.exists()) {
      participants = participantIds(snap.data() as Record<string, unknown>);
    }
  } catch {
    participants = [];
  }

  const unreadUpdates: Record<string, unknown> = {
    [`unreadCount.${senderId}`]: 0,
  };
  for (const pid of participants) {
    if (!pid || pid === senderId) continue;
    unreadUpdates[`unreadCount.${pid}`] = increment(1);
  }

  await updateDoc(conversationRef, {
    lastMessage: trimmed,
    lastMessageTime: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...unreadUpdates,
  });
}

export async function markThreadRead(
  conversationId: string,
  readerId: string,
): Promise<void> {
  const db = getDb();
  await updateDoc(doc(db, "conversations", conversationId), {
    [`unreadCount.${readerId}`]: 0,
    [`lastReadAt.${readerId}`]: serverTimestamp(),
    [`lastDeliveredAt.${readerId}`]: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export function otherParticipant(
  thread: ChatThread,
  uid: string,
): { userId: string; name: string } {
  const idx = thread.participantIds.findIndex((id) => id !== uid);
  const userId =
    idx >= 0 ? thread.participantIds[idx]! : thread.participantIds[0] || "";
  const name =
    (idx >= 0 && thread.participantNames[idx]) ||
    thread.participantNames.find((n) => n) ||
    "chat";
  return { userId, name };
}
