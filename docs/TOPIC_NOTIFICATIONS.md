# Topic notifications

## Product behavior

- Topic notifications default to **OFF**. Following a club/constructor does not
  silently opt a user in.
- Football and Formula 1 expose the toggle in their page hero. Other topic pages
  use the same toggle above the topic feed.
- Preferences are stored at
  `users/{uid}/topicNotifications/{topicId}` with `enabled`, `topicId`, `userId`,
  and `updatedAt`. AsyncStorage is only a fast local mirror.
- Device notification permission and disabled device tokens remain the final
  push gate. Legacy/current global profile flags set explicitly to `false`
  (`notificationsEnabled`, `pushNotificationsEnabled`, and equivalent nested
  notification settings) suppress topic delivery too.
- Category-level and per-person prefs are documented in
  `docs/NOTIFICATION_PREFERENCES.md`. The Topics master category must be on,
  and the dispatcher re-checks preferences immediately before FCM.

## Trusted event queue

There is currently no server-side sport event ingestor in this repository.
Client-side TheSportsDB/Jolpica reads power the sport pages, but they are not a
reliable server event stream. A trusted backend/provider adapter should write
real, source-attributed events to:

`topicEvents/{topicEventId}`

Required fields:

```text
topicId: football | f1 | another topic id
eventType: canonical event type listed below
source: provider/feed name
sourceEventId: stable id from that provider
title: notification title supplied from real event data
body: notification body supplied from real event data
data: optional IDs (matchId, raceId, teamId, constructorId, competitionId, sessionId)
```

Client access to `topicEvents` is denied. `onTopicEventCreate` validates the
schema, queries explicit opt-ins, checks topic/global preferences again
immediately before FCM, and writes idempotent rows to the existing
`notifications` outbox/in-app inbox.

Canonical event types:

- Football: `match_start`, `goal`, `result`
- Formula 1: `race_start`, `qualifying_result`, `race_result`, `dnf`
- Other topics: `update`

Unsupported, unattributed, or copy-less events are marked
`notificationFanout.status = ignored`; they do not notify anyone. Processed
events record fan-out counts under `notificationFanout`.
