# Your Blyp metrics

Ranges are rolling **7 days**, **30 days**, or **all time**. The app makes one
authenticated `GET /creator/insights?period=...` request; the live service joins
Firestore creator data with its authoritative Postgres economy ledger.

## Cards

- **Published** — creator-owned Firestore `posts` published in the range, split
  into video and non-video posts.
- **Likes received / views / comments / shares** — current engagement totals on
  posts published in the range, plus live likes/views where shown. Canonical post
  counters are used for likes/comments; Firestore `reach.impressions` and
  `reach.engagements.shares` supply durable reach signals. These are content-window
  totals rather than events received during the range.
- **Watch time** — summed `reach.engagements.dwellMsTotal` on posts published in
  the range, with `reach.engagements.completions` shown as supporting context.
- **Time live** — overlap of each creator-owned Firestore `liveStreams` session
  with the selected range, summed from start/end timestamps. A stale live session
  stops at its final heartbeat grace window.
- **Live sessions / best live peak** — overlapping sessions and their Firestore
  telemetry.
- **New followers** — current follower documents whose server-written
  `followedAt` falls in the range. All time shows the current follower count.
  An unfollowed account is no longer in this collection, so this is retained new
  followers, not a gross follow-event history.
- **Post gifts** — `gift_events` received in the range whose context ID matches
  one of the creator's Firestore post IDs. Count is gift quantity; coins is gross
  coin value.
- **Live gifts** — received `gift_events` not matching an owned post ID. The
  current gift endpoint supports post or live/battle contexts, so the remaining
  events are live support.
- **You sent** — all `gift_events` sent in the range: quantity, gross coins, and
  distinct recipients.
- **Top gifters / top gifted** — the same range-filtered gift ledger grouped by
  sender or recipient, ordered by coins; names and avatars come from Firestore
  `users`.
- **Battle record** — completed `battle_registry` rows in the range, resolved to
  W/L/D from the user's A/B side and `winner_side`.
- **Top content** — the highest weighted post in the range using likes,
  comments, shares, and views.
- **Following / Saved / Watched / Topics** — existing personal recap sources:
  Firestore follow graph plus local bookmark, watch-history, and preference
  services. These totals are intentionally outside the creator range filter.

## Availability

All displayed numbers are live aggregates; there are no placeholder values.
Timestamped post-engagement deltas are unavailable; the UI states the
content-window basis instead of implying event-window precision.
