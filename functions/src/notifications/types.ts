/**
 * Notification spine — shared types & constants.
 *
 * Design bar (non-negotiable): a notification you'd trust with a real appointment.
 *  - NEVER WRONG: every send is keyed by a deterministic dedupeKey so the same
 *    event can't fire twice, and the dispatcher claims each doc transactionally
 *    so concurrent runs can't double-send.
 *  - NEVER SILENT: every intent becomes a durable `notifications/{id}` document.
 *    Failures retry with backoff; permanent failures become `dead` but remain
 *    visible. The dispatcher writes a heartbeat that knows what it still owes.
 *  - NEVER LEAVES YOU UNINFORMED: the same durable doc is the in-app inbox and
 *    the catch-up surface, so a missed push still reconciles on next app open.
 */

export const NOTIF_COLLECTIONS = {
  /** Durable outbox + inbox. One doc per (recipient, event). */
  notifications: 'notifications',
  /** Per-user push tokens: users/{uid}/devices/{deviceId}. */
  devicesSub: 'devices',
  /** Job heartbeats / cursors live alongside the rest of the platform state. */
  platformState: 'platformState',
} as const;

/** Heartbeat doc id under platformState. */
export const DISPATCH_HEARTBEAT_DOC = 'notificationDispatch';

export type NotificationType =
  | 'live'
  | 'streak'
  | 'reminder'
  | 'activity'
  | 'battle'
  | 'message'
  | 'team'
  | 'call'
  | 'system';

export type NotificationStatus =
  | 'queued' // waiting for its sendAfter time
  | 'sending' // claimed by a dispatcher run (transient)
  | 'sent' // delivered to at least one device
  | 'failed' // retriable failure; will be retried after nextAttemptAt
  | 'dead' // exhausted retries; kept for visibility, never silently dropped
  | 'no_device'; // user has no registered device yet (kept for inbox/catch-up)

export interface NotificationDoc {
  userId: string; // recipient uid (== Cognito sub == Firebase uid)
  type: NotificationType;
  title: string;
  body: string;
  /** FCM data payload — strings only (deep link target etc.). */
  data: Record<string, string>;
  /** Deterministic key; the doc id is derived from it so duplicates collapse. */
  dedupeKey: string;
  /** Coalesces stale pushes on-device (e.g. one per stream). */
  collapseKey?: string;
  status: NotificationStatus;
  /** epoch ms; the dispatcher only sends when now >= sendAfter. */
  sendAfter: number;
  /** epoch ms a dispatcher set status='sending'; used to recover stuck claims. */
  sendingSince?: number;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: number; // epoch ms
  lastError?: string;
  createdAt: number; // epoch ms
  sentAt?: number; // epoch ms
  deliveredDeviceCount?: number;
}

export const DEFAULT_MAX_ATTEMPTS = 5;

/** Exponential backoff with a sane ceiling (ms). attempt is 1-based. */
export function backoffMs(attempt: number): number {
  const base = 30_000; // 30s
  const ms = base * Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(ms, 30 * 60_000); // cap at 30 min
}
