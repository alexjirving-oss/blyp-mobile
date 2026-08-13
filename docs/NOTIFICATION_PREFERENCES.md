# Notification preferences

Infinite customization of Blyp push parameters: global categories plus per-person
overrides, enforced on the server before FCM (not UI-only).

## Precedence

1. **Master** `pushEnabled: false` (or legacy profile mute flags) → deny all
2. **Per-person override** for the notification actor (`hostId` / `senderId` / …):
   - `everything` → allow (topics still need per-topic opt-in)
   - `nothing` → deny
   - `custom` → explicit category bool if set, else fall through
3. **Global category** toggle (defaults below when unset)
4. **Topics** additionally require `users/{uid}/topicNotifications/{topicId}` enabled

Per-person beats global categories. Master beats per-person.

## Storage

| Path | Purpose |
|------|---------|
| `users/{uid}/notificationSettings/global` | `pushEnabled`, `categories`, `updatedAt` |
| `users/{uid}/notificationOverrides/{targetUid}` | `mode`, `categories`, `updatedAt` |
| `users/{uid}/topicNotifications/{topicId}` | Sport/topic opt-in (unchanged) |

AsyncStorage mirrors global settings only (`@blyp/notificationSettings/{uid}`).

### Firestore rules (deploy path)

Production deploys **`firestore.wave0-live.rules`** (see `firebase.json` → `firestore.rules`), not `firestore.rules`.
Keep `notificationSettings` / `notificationOverrides` blocks in sync in the wave0-live file, then:

```powershell
firebase deploy --only firestore:rules --project blyp-master
```

## Categories

| Key | Default | Covers |
|-----|---------|--------|
| `live` | on | Go-live fan-out, guest invite, live watches |
| `message` | on | DMs / group chat |
| `battle` | on | Battle invites, schedule, live, reminders |
| `team` | on | Join/audition/team chat |
| `call` | on | Incoming LiveKit calls (direct FCM gated too) |
| `gift` | on | Post gifts |
| `presence` | on | Online watches (still requires a watch) |
| `streak` | **off** | Daily streak nudges |
| `system` | on | Admin / welcome / product |
| `topic` | on | Master for sport topics (per-topic still opt-in) |
| `follow` | **off** | Future follower push |
| `social` | **off** | Future comments/likes push |
| `dating` | **off** | Future dating push |

## UI

- **Notifications** (`NotificationSettings`) — device permission, master, categories, people list
- **Notifications from @user** (`PersonNotificationSettings`) — presets + custom; entry from profile bell / Ôï» menu
- Topic page toggles remain for per-topic opt-in

## Enforcement

- `functions/src/notifications/dispatcher.ts` — every outbox send
- `functions/src/calls/livekit.ts` — direct call FCM
- `functions/src/notifications/topicEvents.ts` — topic fan-out

## Client

- `src/services/notificationPreferencesService.js`
- `src/constants/notificationCategories.js`
