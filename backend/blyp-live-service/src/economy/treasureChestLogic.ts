/**
 * Pure helpers for daily treasure chest (unit-tested without DB).
 *
 * Verified gate (OR across sources — either is enough):
 *   1. Postgres user_admin_state.metadata.verification.isVerified (Mel/admin)
 *   2. Firestore users/{uid}.verified | isVerified | verificationStatus==='verified'
 *      (public badge from blypVerificationSubmit)
 */

export function utcDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function baseIdempotencyKey(userId: string, day: string): string {
  return `treasure:base:${userId}:${day}`;
}

export function bonusIdempotencyKey(userId: string, day: string): string {
  return `treasure:bonus:${userId}:${day}`;
}

export function isVerifiedFromAdminMetadata(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object') return false;
  const verification = (metadata as Record<string, unknown>).verification;
  if (!verification || typeof verification !== 'object') return false;
  return (verification as Record<string, unknown>).isVerified === true;
}

export function isVerifiedFromFirestoreUser(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  if (d.verified === true || d.isVerified === true) return true;
  return String(d.verificationStatus || '').toLowerCase().trim() === 'verified';
}

export function isUserVerified(opts: {
  adminMetadata?: unknown;
  firestoreUser?: unknown;
}): boolean {
  return (
    isVerifiedFromAdminMetadata(opts.adminMetadata) ||
    isVerifiedFromFirestoreUser(opts.firestoreUser)
  );
}

export type TreasurePostLike = {
  postId?: string;
  videoUrl?: string | null;
  mediaUrl?: string | null;
  postType?: string | null;
  createdAt?: string | null;
  isHidden?: boolean;
};

/** Treat as a video post for the bonus action. */
export function isVideoPost(post: TreasurePostLike): boolean {
  if (post.isHidden === true) return false;
  if (post.videoUrl && String(post.videoUrl).trim()) return true;
  const t = String(post.postType || '').toLowerCase();
  if (t.includes('video') || t === 'short' || t === 'reel' || t === 'clip') return true;
  const url = String(post.mediaUrl || '');
  return /\.(mp4|mov|webm|m3u8)(\?|$)/i.test(url);
}

export function postCreatedOnUtcDay(createdAtIso: string | null | undefined, day: string): boolean {
  if (!createdAtIso) return false;
  const ms = Date.parse(createdAtIso);
  if (!Number.isFinite(ms)) return false;
  return utcDay(ms) === day;
}

/**
 * Find a qualifying video post created on the given UTC day.
 * If postId is provided, that post must match; otherwise any recent match.
 */
export function findQualifyingVideoPost(
  posts: TreasurePostLike[],
  day: string,
  postId?: string | null
): TreasurePostLike | null {
  const wantId = postId ? String(postId).trim() : '';
  for (const post of posts) {
    if (wantId && String(post.postId || '').trim() !== wantId) continue;
    if (!isVideoPost(post)) continue;
    if (!postCreatedOnUtcDay(post.createdAt, day)) continue;
    return post;
  }
  return null;
}

export type TreasurePeekShape = {
  enabled: boolean;
  verified: boolean;
  day: string;
  resetAtUtc: string;
  baseCoins: number;
  bonusCoins: number;
  baseClaimedToday: boolean;
  bonusClaimedToday: boolean;
  bonusEligible: boolean;
  claimableBase: number;
  claimableBonus: number;
};

export function buildTreasurePeek(input: {
  enabled: boolean;
  verified: boolean;
  day: string;
  baseCoins: number;
  bonusCoins: number;
  baseClaimedToday: boolean;
  bonusClaimedToday: boolean;
  hasVideoPostToday: boolean;
}): TreasurePeekShape {
  const {
    enabled,
    verified,
    day,
    baseCoins,
    bonusCoins,
    baseClaimedToday,
    bonusClaimedToday,
    hasVideoPostToday,
  } = input;
  const bonusEligible =
    enabled && verified && baseClaimedToday && !bonusClaimedToday && hasVideoPostToday;
  return {
    enabled,
    verified,
    day,
    resetAtUtc: `${day}T00:00:00.000Z`,
    baseCoins,
    bonusCoins,
    baseClaimedToday,
    bonusClaimedToday,
    bonusEligible,
    claimableBase: enabled && verified && !baseClaimedToday ? baseCoins : 0,
    claimableBonus: bonusEligible ? bonusCoins : 0,
  };
}
