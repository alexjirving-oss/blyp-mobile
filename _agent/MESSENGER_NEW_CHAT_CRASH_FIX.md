# Messenger new-chat crash fix (new accounts)

**Status:** committed — rebase / rebake required before Play ship  
**Commit message:** `fix(messenger): prevent crash starting conversation on new accounts`  
**SHA:** `46ce839840b1c5eb2f289683b8aa1cb4d2881b28`  
**Short:** `46ce839`  
**Branch:** `feat/rooms-presence-ambassador`  
**Worktree:** `C:\Users\Alex\Blyp26-eas-modern`

## Root cause

`FindPeopleScreen` (Phase 2 club discovery) referenced **`clubFilterId`** and **`clubFilterLabel`** in render and `filterUsers()` without ever defining them.

New accounts with empty Messages hit **Start New Chat** / FAB → `navigation.navigate('FindPeople')` → immediate **`ReferenceError: clubFilterId is not defined`** → app crash.

Empty contact lists were not the primary deref; the undefined club-filter identifiers crashed before any list rendered.

## Fix

| File | Change |
|------|--------|
| `src/screens/FindPeopleScreen.js` | Define club filter state from `route.params`; clearable chip; safe lists/empty UI; guard `startNewChat` when peer id missing |
| `src/screens/MessengerScreen.js` | Guard `startNewChat` peer id; honest empty-network copy; safe `chats` filter |
| `src/services/messaging/conversationsMessagingService.js` | Reject missing/self `otherUserId` in `createOrGetDirectThread` |

Existing DM threads for users who already have chats are unchanged (same navigate + createOrGet path when peer id is present).

## AAB / Play tip

- Parallel Play AAB bake may already be running on an older tip (see in-flight `BUILD_RELEASE_CANDIDATE` / Gradle failures).
- Audio fix **`7717575`** (`fix(feed): stop For You video audio flicker`) also needs to ship.
- **This messenger crash fix must ship in the same (or a newer) AAB** — tip the AAB agent to **rebake** from a tip that includes both:
  - `7717575` (For You audio)
  - `46ce839` (messenger new-chat crash)

Do **not** ship an AAB frozen before `46ce839` as fixing new-account Messages crash.

## Verify

1. Fresh / new account → Messages → **Start New Chat** (or FAB) → Find People opens, no crash.
2. Empty network → honest empty / search copy.
3. Account with existing DMs → open thread / send still works.
4. Optional: Search → club → Find People club filter chip works and can clear.
