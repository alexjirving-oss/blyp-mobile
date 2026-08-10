// shareService.js
//
// Builds Blyp share links and opens the native share sheet for posts, profiles
// and Blyp queries.
//
// For posts we share a clean HTTPS web link (blyp.world/p/{id}) — NOT the raw
// blyp:// scheme and NOT giant ?t=&img=&v= query strings (WhatsApp truncates
// those and fails the preview). The Netlify share-post function server-renders
// og:title / og:image from Firestore for crawlers; humans land on /v/{id}.
// All share calls are best-effort and never throw.

import { Share } from 'react-native';

const SCHEME = 'blyp://';
const WEB_BASE = 'https://blyp.world';

export const postUrl = (id) => `${SCHEME}post/${id}`;
export const userUrl = (id) => `${SCHEME}user/${id}`;
export const blypUrl = (q) => `${SCHEME}blyp?q=${encodeURIComponent(String(q || ''))}`;

const pickStr = (...vals) =>
  vals.map((v) => (typeof v === 'string' ? v.trim() : '')).find((v) => v.length > 0) || '';

// Public, crawlable HTTPS link that yields a WhatsApp/iMessage preview tile.
export const postWebUrl = (post) => {
  const id = post?.id;
  if (!id) return WEB_BASE;
  return `${WEB_BASE}/p/${encodeURIComponent(String(id))}`;
};

async function safeShare(content) {
  try {
    await Share.share(content);
    return true;
  } catch (e) {
    console.warn('[SHARE] failed', e?.message || String(e));
    return false;
  }
}

export async function sharePost(post) {
  if (!post?.id) return false;
  const title = post.title || post.captionTitle || post.caption || post.description || 'a post on Blyp';
  const link = postWebUrl(post);
  // Put the link last so chat apps attach the preview tile to the message.
  return safeShare({
    title: 'Share post',
    message: `Check out "${title}" on Blyp\n${link}`,
    url: link,
  });
}

/** Share one or many posts in a single sheet (combined links when multi). */
export async function sharePosts(posts) {
  const list = (Array.isArray(posts) ? posts : []).filter((p) => p?.id);
  if (list.length === 0) return false;
  if (list.length === 1) return sharePost(list[0]);
  const lines = list.map((post) => {
    const title = post.title || post.captionTitle || post.caption || post.description || 'a post';
    return `• "${title}"\n${postWebUrl(post)}`;
  });
  return safeShare({
    title: 'Share posts',
    message: `Check out these posts on Blyp\n\n${lines.join('\n\n')}`,
  });
}

export async function shareProfile(user) {
  const id = user?.id || user?.uid || user?.userId;
  if (!id) return false;
  const name = String(user.username || user.displayName || 'a creator').replace(/^@/, '');
  return safeShare({
    title: 'Share Stage',
    message: `Visit @${name}'s Stage on Blyp\n${userUrl(id)}`,
  });
}

export async function shareBlyp(query, answer) {
  const q = String(query || '').trim();
  if (!q) return false;
  const lead = answer ? `${answer}\n\n` : '';
  return safeShare({
    title: 'Share from Blyp',
    message: `${lead}Ask Blyp: "${q}"\n${blypUrl(q)}`,
  });
}

export async function shareUrl(url, title) {
  const u = String(url || '').trim();
  if (!u) return false;
  const lead = title ? `${title}\n` : '';
  return safeShare({ title: 'Share link', message: `${lead}${u}`, url: u });
}

export const roomUrl = (roomId) => `${SCHEME}room/${encodeURIComponent(String(roomId || ''))}`;

export const teamUrl = (teamId) => `${SCHEME}team/${encodeURIComponent(String(teamId || ''))}`;

export const teamWebUrl = (team) => {
  const id = team?.id || team?.teamId;
  if (!id) return WEB_BASE;
  const title = pickStr(team?.name) || 'a team on Blyp';
  const parts = [`t=${encodeURIComponent(title.slice(0, 140))}`];
  if (team?.leaderName) parts.push(`leader=${encodeURIComponent(String(team.leaderName).slice(0, 80))}`);
  return `${WEB_BASE}/team/${encodeURIComponent(String(id))}?${parts.join('&')}`;
};

export const roomWebUrl = (room) => {
  const id = room?.roomId || room?.id;
  if (!id) return WEB_BASE;
  const title = pickStr(room?.title, room?.name) || 'a room on Blyp';
  const topic = pickStr(room?.topicLabel, room?.category);
  const parts = [`t=${encodeURIComponent(title.slice(0, 140))}`];
  if (topic) parts.push(`topic=${encodeURIComponent(topic.slice(0, 80))}`);
  return `${WEB_BASE}/room/${encodeURIComponent(String(id))}?${parts.join('&')}`;
};

/** Share a topic / chat room invite (HTTPS + deep link fallback in message). */
export async function shareRoom(room) {
  const id = room?.roomId || room?.id;
  if (!id) return false;
  const title = pickStr(room?.title, room?.name) || 'a room on Blyp';
  const topic = pickStr(room?.topicLabel, room?.category);
  const isChat = !!room?.id && !room?.roomId && !room?.topicId;
  const link = roomWebUrl({ ...room, roomId: id, title });
  const deep = isChat
    ? `${SCHEME}chatroom/${encodeURIComponent(String(id))}`
    : roomUrl(id);
  const topicBit = topic ? ` (${topic})` : '';
  return safeShare({
    title: 'Invite to room',
    message: `Join “${title}”${topicBit} on Blyp\n${link}\n${deep}`,
    url: link,
  });
}

/** Share an invite to join a Blyp creator team. */
export async function shareTeam(team) {
  const id = team?.id || team?.teamId;
  if (!id) return false;
  const name = pickStr(team?.name) || 'our team';
  const link = teamWebUrl(team);
  const deep = teamUrl(id);
  return safeShare({
    title: 'Invite to team',
    message: `Join ${name} on Blyp — creator battles, live support, and crew goals.\n${link}\n${deep}`,
    url: link,
  });
}

export default {
  postUrl,
  postWebUrl,
  userUrl,
  blypUrl,
  roomUrl,
  roomWebUrl,
  teamUrl,
  teamWebUrl,
  sharePost,
  sharePosts,
  shareProfile,
  shareBlyp,
  shareUrl,
  shareRoom,
  shareTeam,
};
