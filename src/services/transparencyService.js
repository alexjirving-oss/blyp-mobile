// transparencyService.js
//
// Data + copy for the Blyp Transparency hub (see BLYP_CHARTER.md). The whole point
// of Blyp is that nothing about how we rank, pay, charge or moderate is hidden. This
// service gathers, in plain English:
//   - the platform rules everyone can read,
//   - exactly what data Blyp holds about you,
//   - how your own posts are performing (their Blyp Score / wave),
//   - your standing (private rating + public positive-only badge),
//   - the published economics ("show our working").
//
// It is read-only and degrades gracefully if Firestore is unavailable.

import { db, firebaseEnabled } from '../config/firebase';
import { reachSummary } from './blypReachClient';

// ---------------------------------------------------------------------------
// Published, human-readable platform rules (the Charter, in short). Same for all.
// ---------------------------------------------------------------------------
export const PLATFORM_RULES = [
  {
    icon: 'trending-up-outline',
    title: 'Your posts earn their reach',
    body:
      'Every post is shown to a small, relevant sample first. If real people genuinely engage, it goes wider, wave by wave. Paying to Boost only buys a bigger, faster test — never a place at the top.',
  },
  {
    icon: 'cash-outline',
    title: 'Creators get the majority share',
    body:
      'When your content earns — including when it answers a search — most of that money is yours, and you can see the maths.',
  },
  {
    icon: 'pricetag-outline',
    title: 'Ads are labelled and capped',
    body:
      'One clearly labelled sponsored slot, matched to your query (not a profile of you), and it can never outrank the top honest result. Pricing is published, never a blind auction.',
  },
  {
    icon: 'shield-checkmark-outline',
    title: 'Illegal is illegal; drama is yours to filter',
    body:
      'Unlawful content means removal and, where the law requires, the authorities. Everything lawful-but-annoying is for you to block, mute and move past — we do not referee who said what.',
  },
  {
    icon: 'people-outline',
    title: 'Brigading does not work',
    body:
      'Reports are weighted by track record and checked for coordination. A swarm of throwaway accounts is discounted and the coordinators get flagged — not their target.',
  },
  {
    icon: 'document-text-outline',
    title: 'Fair process',
    body:
      'Moderation comes with the exact reason and an appeal. The penalty ladder leans forgiving — a warning, then reduced reach, then a pause — and your standing recovers with good behaviour.',
  },
];

// ---------------------------------------------------------------------------
// Plans (display copy). Billing runs through the app store; reach is never for sale.
// ---------------------------------------------------------------------------
export const PLANS = [
  {
    id: 'trial',
    name: '30-day free trial',
    price: 'Free',
    blurb: 'The whole app unlocked for 30 days. Cancel any time before it ends and pay nothing.',
    highlight: false,
  },
  {
    id: 'free',
    name: 'Free',
    price: '£0',
    blurb:
      'After the trial: posts, follows, messages, gifting and your feed all keep working. Premium extras (AI captions, Blyp answers + voice, AI sport pages, Dating) pause.',
    highlight: false,
  },
  {
    id: 'plus',
    name: 'Blyp Plus',
    price: '$4.99/mo',
    blurb: 'Everything on — AI features and Dating, all the time.',
    highlight: true,
  },
  {
    id: 'plus_coins',
    name: 'Blyp Plus + Coins',
    price: '$9.99/mo',
    blurb:
      'Everything in Plus (AI + Dating), plus 999 coins every month — roughly your money back as spendable currency. Coins gift to creators or convert to gems; they are never cashable.',
    highlight: false,
  },
];

// ---------------------------------------------------------------------------
// Published economics ("show our working"). Concrete, not vibes.
// ---------------------------------------------------------------------------
export const ECONOMICS = [
  { label: 'Creator share of what their content earns', value: 'Majority to the creator' },
  { label: 'Gifts — share to the receiving creator', value: '50%' },
  { label: 'Sponsored slots per results page', value: 'Max 1, always labelled' },
  { label: 'Can paying outrank the top honest result?', value: 'Never' },
  { label: 'Purchased coins → cash', value: 'Not redeemable (spend-only)' },
  { label: 'Creator gem earnings → cash', value: 'Withdraw via Stripe after hold — no platform fee' },
  { label: 'Your data sold by default', value: 'No — only ever a paid, opt-in exchange with you' },
];

// ---------------------------------------------------------------------------
// What data Blyp holds about you — described plainly, with why + retention.
// ---------------------------------------------------------------------------
export function yourDataCategories() {
  return [
    {
      icon: 'person-outline',
      title: 'Your profile',
      detail: 'Name/handle, avatar, bio and verification status. Used to show who you are. Kept while your account exists.',
    },
    {
      icon: 'videocam-outline',
      title: 'Your content',
      detail: 'Your posts, captions and their edit history. Kept while your account exists; you can delete any post.',
    },
    {
      icon: 'pulse-outline',
      title: 'How your posts perform',
      detail: 'Aggregate impressions and engagement that produce your Blyp Score. Raw signals are pruned after 30 days; the score stays on the post.',
    },
    {
      icon: 'search-outline',
      title: 'Search activity',
      detail: 'Your searches and which results you open — stored against a hashed session, never your raw identity, and pruned after 180 days.',
    },
    {
      icon: 'wallet-outline',
      title: 'Wallet & purchases',
      detail: 'Your coin/gem balances and purchase records, kept for accounting and to honour your balance.',
    },
    {
      icon: 'people-outline',
      title: 'Social graph',
      detail: 'Who you follow and who follows you, used to build your feed. Yours to change any time.',
    },
  ];
}

// ---------------------------------------------------------------------------
// Standing: private behaviour rating (only you see it) + public positive-only badge.
// Provisional until the Phase 8 trust pipeline lands; defaults to good standing.
// ---------------------------------------------------------------------------
export function standingFor(profile) {
  const verified = !!(profile?.verified || profile?.isVerified);
  // Account age in days, if we can infer it.
  let ageDays = 0;
  const created = profile?.createdAt;
  const ms =
    (created && created.toMillis && created.toMillis()) ||
    (typeof created === 'number' ? created : 0) ||
    (created && created.seconds ? created.seconds * 1000 : 0);
  if (ms) ageDays = Math.max(0, Math.floor((Date.now() - ms) / 86400000));

  let badgeTier = 'new';
  let badgeLabel = 'New here';
  if (verified && ageDays >= 365) {
    badgeTier = 'legacy';
    badgeLabel = 'Established';
  } else if (verified) {
    badgeTier = 'verified';
    badgeLabel = 'Verified';
  } else if (ageDays >= 90) {
    badgeTier = 'trusted';
    badgeLabel = 'Trusted';
  }

  // Private rating (0..100). Real value arrives with the trust record; default good.
  const privateRating = typeof profile?.accountRating === 'number' ? profile.accountRating : 100;

  return {
    privateRating,
    badgeTier,
    badgeLabel,
    verified,
    ageDays,
  };
}

// ---------------------------------------------------------------------------
// Your posts + their Blyp Score, for the performance section.
// ---------------------------------------------------------------------------
export async function getYourPosts(uid, max = 50) {
  if (!firebaseEnabled || !db || typeof db.collection !== 'function' || !uid) return [];
  try {
    const snap = await db
      .collection('posts')
      .where('userId', '==', uid)
      .limit(max)
      .get();
    const posts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    // Newest first (by `date` or `createdAt`), then attach the plain-English summary.
    posts.sort((a, b) => {
      const ta = a?.date?.toMillis?.() || a?.createdAt || 0;
      const tb = b?.date?.toMillis?.() || b?.createdAt || 0;
      return tb - ta;
    });
    return posts.map((p) => ({ post: p, reach: reachSummary(p) }));
  } catch (e) {
    console.warn('[transparencyService] getYourPosts failed', e?.message || String(e));
    return [];
  }
}

export default {
  PLATFORM_RULES,
  PLANS,
  ECONOMICS,
  yourDataCategories,
  standingFor,
  getYourPosts,
};
