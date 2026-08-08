# For You algorithm audit and v1

Audited and updated: 2026-08-08.

## Blunt summary

Before this change, the production **For You** path was not meaningfully personalized. It queried
recent Firestore posts and randomly shuffled them inside admin-priority buckets. A separate
`rankPosts` function knew about follows and interests, but `HomeScreen` called
`prepareRankedFeed(..., { mode: 'shuffle' })`, so those signals were never used. The user-facing
feed was therefore chronological candidate selection plus weighted randomness, account/post
admin overrides, earn-your-reach state, and paid-promote placement.

V1 now uses an explicit client-side score and deterministic diversity pass. It is a real
algorithmic ranker, but not a recommendation system in the machine-learning sense. It has no
embedding model, collaborative filtering, learned weights, per-viewer watch history model, or
server-generated candidate set.

## Current data flow

1. `HomeScreen` activates the listener only for authenticated users while Home is focused and
   either For You (`A`) or What's Hot (`B`) is selected.
2. The opening candidate page is:
   `posts.orderBy('date', 'desc').limit(15).onSnapshot(...)`.
3. Blocked creators are removed client-side. For You eligibility then keeps only playable video
   posts with sound (`isForYouFeedPost`). Despite an old comment saying “all posts”, images,
   audio, silent video, and video without a usable URL are excluded.
4. The screen paints that date-ordered page immediately. In the background it:
   - hydrates each creator's account feed-priority tier from `users/{uid}` (60-second cache);
   - attaches active paid-promote metadata;
   - removes account-suppressed creators;
   - scores and diversifies the candidates;
   - softly swaps the ranked order only if the viewer is still on item zero.
5. Near the end, pagination keeps querying older `date` pages until it gathers 12 eligible
   videos. Once date-ordered documents are exhausted, it scans `posts` in document-ID order to
   recover legacy posts with no `date`.
6. Each fetched page is ranked independently and appended. The complete accumulated feed is not
   globally re-ranked.
7. After the corpus is exhausted, Home appends another cycle of the known corpus with new
   `feedKey` values. Recently viewed IDs are penalized when this re-ranking occurs.
8. The separate Home hub, Following feed, topic pages, and other tabs retain their existing
   queries/order. This change only switches the For You ordering path.

There is no server-side feed endpoint. Cloud Functions provide `blypPostEvent` and
`blypReachSweep`: the client batches impressions/engagement/watch events, the scheduled function
folds them into `post.reach`, and the client ranker consumes that aggregate state. Cloud Functions
do not select candidates or return a viewer-specific feed.

`PerformanceStore` is unrelated to ranking. It is a bounded in-memory marks/spans/render/network
collector. `HomeScreen` does not use its hooks, so there are currently no feed-fetch, time-to-first
item, ranking-duration, or re-rank metrics in that store.

## V1 scoring

For each eligible candidate:

```text
score =
  follow affinity
  + topic interest
  + freshness
  + public engagement
  + aggregate watch quality
  + earn-your-reach adjustment
  + account/post admin adjustment
  + paid-promote adjustment
  + not-seen adjustment
```

Concrete terms:

- **Follow affinity:** `+26` when the creator is in the live following set.
- **Topic interest:** `+8` per matched onboarding interest ID, label, or label token, capped at
  `+24`. Matching uses title, caption, description, category, topic/topicId, hashtags, and sport
  tags. It is substring matching, not semantic understanding.
- **Freshness:** `32 * 0.5^(ageHours / 24)`. A new post gets about `+32`, at 24 hours `+16`, at
  48 hours `+8`. Missing dates receive no freshness points.
- **Public engagement:** likes + 2×comments + 4×shares enter a `log1p` curve capped at `+24`.
  Gift coins use a separate `log1p` curve capped at `+10`. Alias fields use the maximum rather
  than being summed, avoiding double-counting denormalized counters.
- **Watch/completion:** when `post.reach` exists, completion rate contributes up to `+14` and
  average dwell contributes up to `+7`. This is aggregate post quality, not the current viewer's
  watch affinity.
- **Earn-your-reach:** existing audition/rising/graduated/resting logic remains. New audition
  posts get temporary sampling; established posts use a fraction of the transparent Blyp Score.
- **Admin controls:** existing account + post tiers remain additive:
  `suppress -500`, `low -60`, `standard 0`, `high +80`, `boost +150`. Account suppression is
  filtered. These values can overwhelm all organic signals and should be understood as editorial
  controls, not organic ranking.
- **Paid promote:** existing promote weights and the existing promote fair-cap remain.
- **Not seen recently:** `+10` if not in the in-memory recent-view set; `-24` if seen. The set is
  bounded to 200 posts and resets when the app process restarts.

Ties preserve candidate order; random jitter has been removed. This makes ranking reproducible,
testable, and less jumpy.

## Diversity and cold start

After score sorting, a greedy pass:

- avoids consecutive posts from the same creator whenever another creator is available;
- allows at most two consecutive followed-source or discovery-source posts when the other source
  exists;
- falls back to the highest-ranked remaining item if a constraint cannot be satisfied.

Cold start is no longer random. With no follows or interests, candidates rank on freshness,
engagement/gifts, aggregate watch quality, earn-your-reach, and not-seen state. Interest choices
are used as soon as preferences hydrate. Followed and discovery content are deliberately mixed,
so follows influence For You but do not turn it into the separate chronological Following tab.

## Fail-open behavior

The snapshot is painted before enrichment. If account-tier or promote enrichment fails,
`prepareRankedFeed` ranks the original organic candidates without enrichment instead of returning
an empty feed. If Firebase itself cannot return candidates, there is nothing local to rank and
the existing empty/error state remains.

Personalization context must be read **after** enrichment awaits via `getContext`, not frozen at
call start. Follows/interests hydrate after Firebase auth and can arrive while promote/account
hydrate is still in flight; a frozen empty context caused a regression where a good soft re-rank
was overwritten by a slower empty-signal rank (looked personalized, then snapped back to
recency). Soft re-ranks also use a generation token so stale completions are ignored.

When the newest-15 organic page contains fewer than three followed creators, Home injects up to
six recent eligible followed posts from a wider date scan before scoring, so follow affinity can
still produce a visible mix.

## Known limitations and audit findings

- **Page-local ranking:** Firestore chooses a newest-15 window before ranking. An excellent older
  post cannot outrank a mediocre post until its older page is fetched.
- **Expensive legacy waterfall:** the missing-`date` recovery phase scans document-ID pages and
  can issue up to 24 page queries in one gather attempt. Normalize post timestamps and retire this
  phase.
- **Live listener churn:** likes/views/comments on opening-page docs re-fire the listener. Home
  preserves order to avoid jumps, so new engagement updates counters but intentionally do not
  continuously re-rank a viewer mid-session.
- **Comment counter integrity:** a prior audit found comment subcollection writes did not
  reliably update `post.commentCount`. The ranker can only use the post document's denormalized
  count, so stale data means stale comment value even though the visible overlay has a live
  subcollection listener.
- **Home watch coverage:** detailed dwell/completion is reported by `MediaViewerScreen`.
  `HomeScreen` currently reports impressions and public views, not playback completion for each
  swipe. Aggregate watch quality therefore has partial coverage.
- **No learned creator affinity:** affinity is binary follow/not-follow. Likes, skips, rewatches,
  hides, profile opens, and creator-level history are not modeled.
- **Seen state is local/session-only:** no cross-device or durable “already seen” store.
- **Interest matching is lexical:** synonyms and ambiguous words are not handled.
- **Moderation/visibility depends on existing filters:** blocked and account-suppressed creators
  are removed, but this change does not introduce a new server-authoritative eligibility policy.
- **Editorial power is large:** admin `high`/`boost` weights dominate organic score. That is
  intentional existing behavior, but the feed should not be described as purely merit-ranked.
- **Promote fair-cap is post-processing:** paid placement can alter the diversity pass's exact
  order. Existing caps still prevent paid content from fully burying organic content.
- **No feed observability:** `PerformanceStore` does not instrument this waterfall.
- **Resolved prior findings:** follow actions on Home now persist via `followUser`/`unfollowUser`;
  post-publish routing targets For You and optimistic uploads prepend. Those older findings should
  not be treated as current defects.

## Verification

Automated:

```powershell
npm test -- --runInBand __tests__/feedRankingService.test.js __tests__/forYouFeedFilter.test.js __tests__/homeScreenFeedHelpers.test.js
npx eslint "src/services/feedRankingService.js" "src/screens/HomeScreen.js" "__tests__/feedRankingService.test.js"
```

The focused suite verifies freshness/cold start, follow + interest + engagement + gift + watch
signals, recent-seen demotion, creator diversity, followed/discovery mixing, eligibility, Home
feed helpers, and enrichment failure fallback.

Manual device check for the next combined bake:

1. Open For You on an account with onboarding interests and several follows.
2. Confirm the first page appears immediately and only reorders while still on the first item.
3. Confirm no adjacent same-creator posts when alternatives exist.
4. Confirm followed content appears but discovery is present within a follow-heavy sequence.
5. Pull to refresh; confirm a stable, sensible order rather than a random reshuffle.
6. Scroll through corpus rollover; previously watched posts should lose priority, with no dead end.
7. Disable/network-fail promote enrichment; existing Firestore candidates should still render.
8. Check Home hub, Following, topics, What's Hot, Categories, and Hashtags for unchanged behavior.

No Android/iOS bake was run. This is ready for the next combined bake.
