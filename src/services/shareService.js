// shareService.js
//
// Builds Blyp share links and opens the native share sheet for posts, profiles
// and Blyp queries.
//
// For posts we share an HTTPS web link (blyp.world) — NOT the raw blyp://
// scheme — so chat apps like WhatsApp render a rich preview tile. The web link
// carries the post title + public thumbnail as query params, which a small
// Netlify function echoes into OpenGraph tags (og:title/og:image) and then
// bounces the human on to the app/store. (WhatsApp's crawler doesn't run JS,
// so the tags must be server-rendered; passing them in the URL avoids any
// Firestore/secret dependency.)
// All share calls are best-effort and never throw.

import { Share } from 'react-native';

const SCHEME = 'blyp://';
const WEB_BASE = 'https://blyp.world';

export const postUrl = (id) => `${SCHEME}post/${id}`;
export const userUrl = (id) => `${SCHEME}user/${id}`;
export const blypUrl = (q) => `${SCHEME}blyp?q=${encodeURIComponent(String(q || ''))}`;

const pickStr = (...vals) =>
  vals.map((v) => (typeof v === 'string' ? v.trim() : '')).find((v) => v.length > 0) || '';

const postThumbFor = (post) =>
  pickStr(
    post?.thumbnail,
    post?.thumbnailUrl,
    post?.posterUrl,
    post?.media?.[0]?.thumbnail,
    post?.imageUrl,
    post?.media?.[0]?.url,
    post?.userPhotoURL,
    post?.user?.avatar,
  );

const postVideoFor = (post) =>
  pickStr(post?.videoUrl, post?.media?.[0]?.url);

// Public, crawlable HTTPS link that yields a WhatsApp/iMessage preview tile.
export const postWebUrl = (post) => {
  const id = post?.id;
  if (!id) return WEB_BASE;
  const title = pickStr(post?.title, post?.captionTitle, post?.caption, post?.description) || 'A post on Blyp';
  const img = postThumbFor(post);
  const vid = postVideoFor(post);
  const parts = [`t=${encodeURIComponent(title.slice(0, 140))}`];
  if (img) parts.push(`img=${encodeURIComponent(img)}`);
  if (vid) parts.push(`v=${encodeURIComponent(vid)}`);
  return `${WEB_BASE}/p/${encodeURIComponent(String(id))}?${parts.join('&')}`;
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

export async function shareProfile(user) {
  const id = user?.id || user?.uid || user?.userId;
  if (!id) return false;
  const name = user.username || user.displayName || 'a creator';
  return safeShare({
    title: 'Share profile',
    message: `Follow @${name} on Blyp\n${userUrl(id)}`,
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

export default { postUrl, postWebUrl, userUrl, blypUrl, sharePost, shareProfile, shareBlyp, shareUrl };
