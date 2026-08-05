// feedRankingService.js
//
// Pure, dependency-free ranking for the "For You" feed. Orders posts by a blend
// of: who you follow, your interests, light engagement, and a small freshness
// jitter so the feed never feels static. Falls back to a plain shuffle when we
// have no personalization signal yet (preserves prior behavior).

function engagement(post) {
  return (
    Number(post.likeCount || post.likes || post.likedBy?.length || 0) +
    Number(post.commentCount || post.comments || 0) * 2
  );
}

const AUDITION_BOOST = 18; // guaranteed early sampling for fresh posts
const AUDITION_SETTLE = 40; // impressions over which the audition boost fades

/** Admin For You priority (Firestore `feedPriority`: less | standard | high). */
const FEED_PRIORITY_HIGH = 80;
const FEED_PRIORITY_LESS = -60;

/**
 * Earn-your-reach adjustment (see BLYP_CHARTER.md). This is what makes reach EARNED:
 *  - a brand-new post gets a temporary "audition" lift so it is actually seen,
 *    which decays as it gathers its first impressions;
 *  - posts that earned a wave rank by their Blyp Score (merit, not payment);
 *  - resting posts are gently down-weighted — never hidden, always able to recover.
 * Legacy posts with no reach state get 0 (behaviour unchanged).
 */
export function reachAdjust(post) {
  const r = post && post.reach;
  if (!r || typeof r !== 'object') return 0;
  const score = Number(r.score || 0);
  if (r.stage === 'resting') return -12 + score * 0.1;
  if (r.stage === 'audition') {
    const seen = Number(r.waveImpressions || 0);
    const fade = Math.max(0, 1 - Math.min(seen / AUDITION_SETTLE, 1));
    return AUDITION_BOOST * fade + score * 0.15;
  }
  // rising / graduated: ranked on earned merit.
  return score * 0.25;
}

/** Score bump from admin feed priority (in-app / dashboard moderation). */
export function feedPriorityAdjust(post) {
  const raw = String(post?.feedPriority || post?.adminPriority || 'standard').toLowerCase();
  if (raw === 'high') return FEED_PRIORITY_HIGH;
  if (raw === 'less' || raw === 'low') return FEED_PRIORITY_LESS;
  return 0;
}

function scorePost(post, terms, following) {
  let s = 0;
  const owner = post.userId || post.uid || post.authorId;
  if (owner && following.has(owner)) s += 50; // strong: people you follow
  if (terms.length) {
    const hay = [
      post.title,
      post.caption,
      post.description,
      post.category,
      Array.isArray(post.hashtags) ? post.hashtags.join(' ') : post.hashtags,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    for (const t of terms) if (hay.includes(t)) s += 8; // interest match
  }
  s += Math.min(engagement(post), 24) * 0.5; // mild popularity nudge
  s += reachAdjust(post); // earn-your-reach: audition lift / earned score / resting
  s += feedPriorityAdjust(post); // admin less / standard / high
  s += Math.random() * 6; // freshness jitter
  return s;
}

/**
 * @param {any[]} posts
 * @param {string[]} terms  lowercased interest terms
 * @param {Set<string>} following  ids the user follows
 */
export function rankPosts(posts, terms = [], following = new Set()) {
  if (!Array.isArray(posts) || posts.length === 0) return posts || [];
  const noSignal = (!terms || terms.length === 0) && (!following || following.size === 0);
  if (noSignal) {
    // Still honour earn-your-reach + admin priority when we have no personalization.
    return [...posts]
      .map((p) => ({ p, s: reachAdjust(p) + feedPriorityAdjust(p) + Math.random() * 12 }))
      .sort((a, b) => b.s - a.s)
      .map((x) => x.p);
  }
  return [...posts]
    .map((p) => ({ p, s: scorePost(p, terms, following) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.p);
}

export default { rankPosts, reachAdjust, feedPriorityAdjust };
