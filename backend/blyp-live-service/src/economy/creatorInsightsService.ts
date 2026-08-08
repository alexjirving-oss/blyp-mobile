import { getFirestore } from '../admin/firestoreAdmin';
import { getEconomyInfra } from './infra';
import { EconomyError } from './economyErrors';

export type CreatorInsightsPeriod = 'week' | 'month' | 'all';

type RawPost = {
  id: string;
  data: Record<string, any>;
};

type RawStream = {
  id: string;
  data: Record<string, any>;
};

type GiftGroup = {
  streamId: string;
  peerUserId: string;
  giftCount: number;
  eventCount: number;
  coins: number;
};

type PersonGiftTotal = {
  userId: string;
  giftCount: number;
  eventCount: number;
  coins: number;
};

type PublicProfile = {
  displayName: string;
  handle: string;
  photoURL: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const FIRESTORE_RESULT_CAP = 1000;
const TOP_PEOPLE_LIMIT = 5;

function finite(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function toMillis(value: any): number | null {
  if (value == null) return null;
  try {
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value.toDate === 'function') return value.toDate().getTime();
    if (typeof value === 'object' && typeof value._seconds === 'number') {
      return value._seconds * 1000;
    }
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function periodStartMs(
  period: CreatorInsightsPeriod,
  nowMs: number = Date.now(),
): number | null {
  if (period === 'week') return nowMs - 7 * DAY_MS;
  if (period === 'month') return nowMs - 30 * DAY_MS;
  return null;
}

function postTimestamp(data: Record<string, any>): number | null {
  return toMillis(data.date ?? data.createdAt ?? data.publishedAt);
}

function reachEngagement(data: Record<string, any>, key: string): number {
  return finite(data.reach?.engagements?.[key]);
}

function postLikes(data: Record<string, any>): number {
  if (Array.isArray(data.likedBy)) return data.likedBy.length;
  if (Array.isArray(data.likes)) return data.likes.length;
  if (data.likeCount != null || data.likes != null) {
    return finite(data.likeCount ?? data.likes);
  }
  return reachEngagement(data, 'likes');
}

function postComments(data: Record<string, any>): number {
  if (Array.isArray(data.comments)) return data.comments.length;
  if (data.commentCount != null || data.comments != null) {
    return finite(data.commentCount ?? data.comments);
  }
  return reachEngagement(data, 'comments');
}

function postShares(data: Record<string, any>): number {
  return Math.max(
    finite(data.shareCount ?? data.sharesCount ?? data.shares),
    reachEngagement(data, 'shares'),
  );
}

function postViews(data: Record<string, any>): number {
  return Math.max(
    finite(data.viewCount ?? data.views ?? data.playCount),
    finite(data.reach?.impressions),
  );
}

function postWatchTimeMs(data: Record<string, any>): number {
  return reachEngagement(data, 'dwellMsTotal');
}

function postCompletions(data: Record<string, any>): number {
  return reachEngagement(data, 'completions');
}

function isVideoPost(data: Record<string, any>): boolean {
  const type = text(data.type).toLowerCase();
  if (type.includes('video') || type === 'reel') return true;
  if (text(data.videoUrl) || text(data.mediaUrl).match(/\.(mp4|mov|m3u8)(\?|$)/i)) return true;
  const media = Array.isArray(data.media) ? data.media : [];
  return media.some((item: any) => {
    const mediaType = text(item?.type).toLowerCase();
    const uri = text(item?.url || item?.uri);
    return mediaType.includes('video') || /\.(mp4|mov|m3u8)(\?|$)/i.test(uri);
  });
}

function postThumbnail(data: Record<string, any>): string | null {
  const media = Array.isArray(data.media) ? data.media : [];
  return (
    text(data.thumbnail) ||
    text(data.thumbnailUrl) ||
    text(data.imageUrl) ||
    text(media[0]?.thumbnail) ||
    text(media[0]?.url || media[0]?.uri) ||
    text(data.videoUrl) ||
    null
  );
}

export function summarizePosts(posts: RawPost[], startAtMs: number | null) {
  const selected = posts.filter(({ data }) => {
    if (startAtMs == null) return true;
    const publishedAt = postTimestamp(data);
    return publishedAt != null && publishedAt >= startAtMs;
  });

  let videoCount = 0;
  let likesReceived = 0;
  let commentsReceived = 0;
  let shares = 0;
  let views = 0;
  let watchTimeMs = 0;
  let completions = 0;
  let best: RawPost | null = null;
  let bestScore = -1;

  for (const post of selected) {
    const video = isVideoPost(post.data);
    if (video) videoCount += 1;
    const likes = postLikes(post.data);
    const comments = postComments(post.data);
    const postSharesTotal = postShares(post.data);
    const postViewsTotal = postViews(post.data);
    likesReceived += likes;
    commentsReceived += comments;
    shares += postSharesTotal;
    views += postViewsTotal;
    watchTimeMs += postWatchTimeMs(post.data);
    completions += postCompletions(post.data);
    const score = likes * 2 + comments * 3 + postSharesTotal * 3 + postViewsTotal * 0.1;
    if (score > bestScore) {
      bestScore = score;
      best = post;
    }
  }

  const bestData = best?.data;
  return {
    publishedCount: selected.length,
    videoCount,
    postCount: selected.length - videoCount,
    likesReceived,
    commentsReceived,
    shares,
    views,
    watchTimeSeconds: Math.round(watchTimeMs / 1000),
    completions,
    bestPost: best && bestData
      ? {
          id: best.id,
          title:
            text(bestData.title) ||
            text(bestData.caption) ||
            text(bestData.description) ||
            'Post',
          thumbnail: postThumbnail(bestData),
          likes: postLikes(bestData),
          comments: postComments(bestData),
          shares: postShares(bestData),
          views: postViews(bestData),
          watchTimeSeconds: Math.round(postWatchTimeMs(bestData) / 1000),
          type: text(bestData.type) || (isVideoPost(bestData) ? 'video' : 'post'),
          videoUrl: text(bestData.videoUrl) || null,
        }
      : null,
  };
}

function streamStartMs(data: Record<string, any>): number | null {
  return toMillis(data.startedAt ?? data.createdAt ?? data.startTime);
}

function streamEndMs(data: Record<string, any>, nowMs: number): number | null {
  const ended = toMillis(data.endedAt ?? data.endTime);
  if (ended != null) return ended;
  const heartbeat = toMillis(data.lastHeartbeatAt ?? data.lastUpdated);
  const status = text(data.status).toLowerCase();
  if (status === 'live' || data.isLive === true) {
    // A stale "live" document must not accrue time forever after a crash.
    return heartbeat == null ? nowMs : Math.min(nowMs, heartbeat + 90_000);
  }
  return heartbeat;
}

export function summarizeStreams(
  streams: RawStream[],
  startAtMs: number | null,
  nowMs: number = Date.now(),
) {
  let sessionCount = 0;
  let durationMs = 0;
  let likesReceived = 0;
  let views = 0;
  let peakViewers = 0;

  for (const stream of streams) {
    const startedAt = streamStartMs(stream.data);
    const endedAt = streamEndMs(stream.data, nowMs);
    if (startedAt == null || endedAt == null || endedAt <= startedAt) continue;
    const clippedStart = startAtMs == null ? startedAt : Math.max(startedAt, startAtMs);
    const clippedEnd = Math.min(endedAt, nowMs);
    if (clippedEnd <= clippedStart) continue;

    sessionCount += 1;
    durationMs += clippedEnd - clippedStart;
    likesReceived += finite(stream.data.likes ?? stream.data.likeCount);
    views += finite(stream.data.totalViews ?? stream.data.views ?? stream.data.viewCount);
    peakViewers = Math.max(
      peakViewers,
      finite(stream.data.peakViewerCount ?? stream.data.peakViewers),
    );
  }

  return {
    sessionCount,
    durationSeconds: Math.round(durationMs / 1000),
    likesReceived,
    views,
    peakViewers,
  };
}

function sumGiftGroups(groups: GiftGroup[]) {
  return groups.reduce(
    (total, group) => ({
      count: total.count + group.giftCount,
      events: total.events + group.eventCount,
      coins: total.coins + group.coins,
    }),
    { count: 0, events: 0, coins: 0 },
  );
}

export function summarizeReceivedGifts(groups: GiftGroup[], postIds: Set<string>) {
  const postGroups: GiftGroup[] = [];
  const liveGroups: GiftGroup[] = [];
  for (const group of groups) {
    if (postIds.has(group.streamId)) postGroups.push(group);
    else liveGroups.push(group);
  }
  return {
    posts: sumGiftGroups(postGroups),
    live: sumGiftGroups(liveGroups),
  };
}

function rankPeople(groups: GiftGroup[]): PersonGiftTotal[] {
  const byUser = new Map<string, PersonGiftTotal>();
  for (const group of groups) {
    if (!group.peerUserId) continue;
    const current = byUser.get(group.peerUserId) || {
      userId: group.peerUserId,
      giftCount: 0,
      eventCount: 0,
      coins: 0,
    };
    current.giftCount += group.giftCount;
    current.eventCount += group.eventCount;
    current.coins += group.coins;
    byUser.set(group.peerUserId, current);
  }
  return Array.from(byUser.values()).sort(
    (a, b) =>
      b.coins - a.coins ||
      b.giftCount - a.giftCount ||
      a.userId.localeCompare(b.userId),
  );
}

export function summarizeSentGifts(groups: GiftGroup[]) {
  const totals = sumGiftGroups(groups);
  return {
    ...totals,
    people: new Set(groups.map((group) => group.peerUserId).filter(Boolean)).size,
  };
}

type BattleRow = {
  creator_uid: string;
  opponent_uid: string;
  winner_side: string | null;
};

export function summarizeBattles(userId: string, rows: BattleRow[]) {
  let wins = 0;
  let losses = 0;
  let draws = 0;
  for (const row of rows) {
    if (!row.winner_side) {
      draws += 1;
      continue;
    }
    const userSide = row.creator_uid === userId ? 'A' : 'B';
    if (row.winner_side === userSide) wins += 1;
    else losses += 1;
  }
  return { played: rows.length, wins, losses, draws };
}

async function countQuery(query: any): Promise<number> {
  try {
    const aggregate = await query.count().get();
    return finite(aggregate.data().count);
  } catch {
    const snapshot = await query.get();
    return finite(snapshot.size);
  }
}

async function loadFirestoreCreatorData(
  userId: string,
  startAtMs: number | null,
): Promise<{
  posts: RawPost[];
  streams: RawStream[];
  followersTotal: number;
  followingTotal: number;
  followersGained: number;
  capped: boolean;
}> {
  const fs = getFirestore();
  if (!fs) {
    throw new EconomyError('PROVIDER_ERROR', 503, 'Creator insights are temporarily unavailable');
  }

  const postsQuery = fs
    .collection('posts')
    .where('userId', '==', userId)
    .limit(FIRESTORE_RESULT_CAP);
  const hostStreamsQuery = fs
    .collection('liveStreams')
    .where('hostUid', '==', userId)
    .limit(FIRESTORE_RESULT_CAP);
  const userStreamsQuery = fs
    .collection('liveStreams')
    .where('userId', '==', userId)
    .limit(FIRESTORE_RESULT_CAP);
  const followersQuery = fs.collection('users').doc(userId).collection('followers');
  const followingQuery = fs.collection('users').doc(userId).collection('following');
  const gainedQuery =
    startAtMs == null
      ? followersQuery
      : followersQuery.where('followedAt', '>=', new Date(startAtMs));

  const [
    postsSnapshot,
    hostStreamsSnapshot,
    userStreamsSnapshot,
    followersTotal,
    followingTotal,
    followersGained,
  ] = await Promise.all([
    postsQuery.get(),
    hostStreamsQuery.get(),
    userStreamsQuery.get(),
    countQuery(followersQuery),
    countQuery(followingQuery),
    startAtMs == null ? countQuery(followersQuery) : countQuery(gainedQuery),
  ]);

  const posts = postsSnapshot.docs.map((doc) => ({
    id: doc.id,
    data: doc.data() || {},
  }));
  const streamsById = new Map<string, RawStream>();
  for (const doc of [...hostStreamsSnapshot.docs, ...userStreamsSnapshot.docs]) {
    const data = doc.data() || {};
    const streamId = text(data.streamId) || doc.id;
    streamsById.set(streamId, { id: streamId, data });
  }

  return {
    posts,
    streams: Array.from(streamsById.values()),
    followersTotal,
    followingTotal,
    followersGained,
    capped:
      postsSnapshot.size >= FIRESTORE_RESULT_CAP ||
      hostStreamsSnapshot.size >= FIRESTORE_RESULT_CAP ||
      userStreamsSnapshot.size >= FIRESTORE_RESULT_CAP,
  };
}

function mapGiftRows(rows: any[]): GiftGroup[] {
  return rows.map((row) => ({
    streamId: text(row.stream_id),
    peerUserId: text(row.peer_user_id),
    giftCount: finite(row.gift_count),
    eventCount: finite(row.event_count),
    coins: finite(row.coins),
  }));
}

async function loadGiftGroups(
  userId: string,
  startAtMs: number | null,
): Promise<{ received: GiftGroup[]; sent: GiftGroup[] }> {
  const { db } = getEconomyInfra();
  let receivedQuery = db('gift_events')
    .select('stream_id')
    .select({ peer_user_id: 'sender_user_id' })
    .select(db.raw('SUM(quantity)::bigint AS gift_count'))
    .select(db.raw('COUNT(*)::bigint AS event_count'))
    .select(db.raw('SUM(coin_cost)::bigint AS coins'))
    .where({ receiver_user_id: userId });
  let sentQuery = db('gift_events')
    .select('stream_id')
    .select({ peer_user_id: 'receiver_user_id' })
    .select(db.raw('SUM(quantity)::bigint AS gift_count'))
    .select(db.raw('COUNT(*)::bigint AS event_count'))
    .select(db.raw('SUM(coin_cost)::bigint AS coins'))
    .where({ sender_user_id: userId });

  if (startAtMs != null) {
    const startAt = new Date(startAtMs);
    receivedQuery = receivedQuery.where('created_at', '>=', startAt);
    sentQuery = sentQuery.where('created_at', '>=', startAt);
  }

  const [receivedRows, sentRows] = await Promise.all([
    receivedQuery.groupBy('stream_id', 'sender_user_id'),
    sentQuery.groupBy('stream_id', 'receiver_user_id'),
  ]);
  return {
    received: mapGiftRows(receivedRows),
    sent: mapGiftRows(sentRows),
  };
}

async function loadBattleRows(
  userId: string,
  startAtMs: number | null,
): Promise<BattleRow[]> {
  const { db } = getEconomyInfra();
  let query = db('battle_registry')
    .select('creator_uid', 'opponent_uid', 'winner_side')
    .where('state', 'ENDED')
    .where((builder) => {
      builder.where('creator_uid', userId).orWhere('opponent_uid', userId);
    });
  if (startAtMs != null) {
    query = query.where('ended_at', '>=', new Date(startAtMs));
  }
  return await query;
}

async function loadPublicProfiles(userIds: string[]): Promise<Map<string, PublicProfile>> {
  const result = new Map<string, PublicProfile>();
  const uniqueIds = Array.from(new Set(userIds.map(text).filter(Boolean)));
  const fs = getFirestore();
  if (!fs || uniqueIds.length === 0) return result;
  try {
    const snapshots = await fs.getAll(
      ...uniqueIds.map((userId) => fs.collection('users').doc(userId)),
    );
    snapshots.forEach((snapshot, index) => {
      const data = snapshot.exists ? snapshot.data() || {} : {};
      const handle = text(data.username || data.handle).replace(/^@/, '');
      result.set(uniqueIds[index], {
        displayName:
          text(data.displayName || data.name) ||
          (handle ? `@${handle}` : 'Blyp creator'),
        handle,
        photoURL:
          text(data.photoURL || data.avatar || data.profileImage || data.profilePhoto) ||
          null,
      });
    });
  } catch {
    // Gift totals remain useful when profile enrichment is briefly unavailable.
  }
  return result;
}

function withProfiles(
  rows: PersonGiftTotal[],
  profiles: Map<string, PublicProfile>,
) {
  return rows.slice(0, TOP_PEOPLE_LIMIT).map((row) => {
    const profile = profiles.get(row.userId);
    return {
      ...row,
      displayName: profile?.displayName || 'Blyp creator',
      handle: profile?.handle || '',
      photoURL: profile?.photoURL || null,
    };
  });
}

export async function getCreatorInsights(
  userId: string,
  period: CreatorInsightsPeriod,
  nowMs: number = Date.now(),
) {
  const uid = text(userId);
  if (!uid) throw new EconomyError('UNAUTH', 401, 'Unauthorized');
  const startAtMs = periodStartMs(period, nowMs);

  const [firestoreData, giftGroups, battleRows] = await Promise.all([
    loadFirestoreCreatorData(uid, startAtMs),
    loadGiftGroups(uid, startAtMs),
    loadBattleRows(uid, startAtMs),
  ]);

  const content = summarizePosts(firestoreData.posts, startAtMs);
  const live = summarizeStreams(firestoreData.streams, startAtMs, nowMs);
  const postIds = new Set(firestoreData.posts.map((post) => post.id));
  const received = summarizeReceivedGifts(giftGroups.received, postIds);
  const sent = summarizeSentGifts(giftGroups.sent);
  const rankedGifters = rankPeople(giftGroups.received);
  const rankedGifted = rankPeople(giftGroups.sent);
  const profileIds = [
    ...rankedGifters.slice(0, TOP_PEOPLE_LIMIT).map((row) => row.userId),
    ...rankedGifted.slice(0, TOP_PEOPLE_LIMIT).map((row) => row.userId),
  ];
  const profiles = await loadPublicProfiles(profileIds);

  return {
    period,
    window: {
      startAt: startAtMs == null ? null : new Date(startAtMs).toISOString(),
      endAt: new Date(nowMs).toISOString(),
    },
    content,
    live,
    audience: {
      followersTotal: firestoreData.followersTotal,
      followingTotal: firestoreData.followingTotal,
      followersGained: firestoreData.followersGained,
    },
    gifts: {
      posts: received.posts,
      live: received.live,
      sent,
      topGifters: withProfiles(rankedGifters, profiles),
      topGifted: withProfiles(rankedGifted, profiles),
    },
    battles: summarizeBattles(uid, battleRows),
    availability: {
      watchTime: 'post_reach_dwell_ms',
      resultCapped: firestoreData.capped,
      postEngagementBasis: 'current_totals_on_posts_published_in_window',
      followerGainBasis:
        period === 'all'
          ? 'current_follower_total'
          : 'current_followers_with_followed_at_in_window',
      giftContextBasis: 'owned_post_id_else_live_session',
    },
    generatedAt: new Date(nowMs).toISOString(),
  };
}
