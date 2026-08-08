# Football supporter page: information architecture and data audit

## Product goal

The Football page should answer a supporter’s immediate questions in this order:

1. Who do we play next, when, where, and how can I follow it?
2. How are we doing?
3. What just happened?
4. Who is in the squad and who is unavailable?
5. What is the latest club conversation on Blyp?

The implementation keeps Blyp’s editorial near-black surfaces and restrained teal accent. Win,
draw, and loss colours are status signals only, not a competing page theme.

## Current route and ownership

- `HomeScreen` routes the `topic:football` page to `SportPagePanel`.
- Followed clubs are cached in AsyncStorage and synced best-effort to
  `users/{uid}/followedTeams/{teamId}` in Firestore.
- Profile club choices can seed SportsDB club IDs through `profileIdentityCatalog`.
- The page is intentionally provider-neutral outside `footballDataService`.

## Shipped information architecture

### Match centre — real data

- Next opponent, competition, local-device kickoff time, home/away status, and venue.
- Broadcaster/channel only when the event feed supplies one. The UI explicitly says when regional
  broadcast information is not supplied; it never guesses rights.
- Last-five W/D/L form derived from real recent results.
- Brief H2H signal derived from meetings present in the recent-results feed.
- Matchday Live/preview CTA uses the existing matchday feature gate.
- Official club-site CTA appears only when TheSportsDB supplies a website. This is deliberately not
  labelled “Tickets” because the current source does not provide a verified ticket URL.

### Results — real data

- Up to five previous matches with score, competition, and local date/time.
- Rows expand to show venue and round when those fields exist.

### Table / standings — real data

- Followed-club window in its league table, otherwise the Premier League fallback.
- Position, points, played, goal difference, and provider form string.
- Current season is tried first, then the previous season for pre-season/provider gaps.

### Squad — real data where available

- TheSportsDB current-player endpoint, grouped into goalkeepers, defenders, midfielders, forwards,
  and uncategorised squad members.
- Shirt number and exact provider position are shown where supplied.

### News and media — real Blyp data

- Firestore `posts` queried through `discoveryService`.
- Explicit `sportTags: ["football"]` and followed `teamIds` are strongly ranked; caption/topic term
  matching remains a fallback.
- Video posts become the media rail and all matched posts remain in the latest grid.

### Notifications — live

- Existing Football topic toggle writes the user preference and attempts native push registration.
- In-app delivery remains available when OS notification permission is declined.
- Event dispatch still depends on verified backend topic events; the client does not synthesize
  goals or results.

### Social / Blyp — real data

- Tagged football/team posts, suggested football creators, follow/unfollow, and media viewer links.
- Active Firestore-backed rooms with `topicId == "football"` appear occupancy-first and open the
  existing room experience.

## Clearly labelled provider gaps

These are shell states, not fabricated content:

- Injuries and suspensions: no current licensed feed.
- Contract end dates / “due to leave”: no current feed.
- Confirmed transfers and rumoured in/out: no current feed.
- Ticket purchase links: no verified ticket endpoint.
- Broadcaster/streaming rights: often absent on TheSportsDB free event records and region-specific.
- Rich H2H: only recent meetings already present in the club’s last-results response.
- Squad availability varies by club; an empty response is described as unavailable, never as an
  empty squad.

## Providers and credentials

| Provider | Purpose | Key requirement |
| --- | --- | --- |
| TheSportsDB | Club search/metadata, fixtures, results, standings, squads, occasional TV field | Existing public/free endpoint; no user secret |
| Firestore | Followed clubs, Blyp posts, creators, topic rooms, notification preferences | Existing Firebase app configuration and authenticated rules where required |
| Matchday service | Existing live/preview route | Existing app/backend feature configuration |
| Expo push + topic event backend | Topic notification registration and delivery | Existing notification backend credentials; no client-side secret |

No API-Football integration was found in the audited client. A future licensed provider such as
API-Football would be needed for reliable injuries, suspensions, transfers, richer H2H, and
region-aware broadcast coverage. Its key must remain server-side; the mobile bundle must call a
controlled backend endpoint rather than embed the key.

## Recommended next provider contract

Add a server-owned `ClubSupporterSnapshot` contract with independently nullable fields:

- `nextMatch`, `recentResults`, `standings`, `squad`
- `injuries`, `suspensions`
- `transfers.confirmed`, `transfers.rumouredIn`, `transfers.rumouredOut`
- `broadcasts[]` scoped by country/region
- `ticketUrl` with source and verification timestamp
- `provider`, `fetchedAt`, and per-section freshness/error metadata

The client should retain the current “unavailable” behaviour per section so one provider outage
does not blank the whole supporter page.
