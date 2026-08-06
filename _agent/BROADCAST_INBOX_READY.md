# Broadcast inbox ready for AAB

- **Commit:** `1eb295d2d9db91c649534e96ce95d25796998f3d`
- **Short:** `1eb295d`
- **Message:** `fix(comms): render admin broadcasts in app inbox`
- **Branch tip at write:** `feat/rooms-presence-ambassador` (includes teams `5e16aa3` in ancestry)
- **Written:** 2026-08-06

## What landed

Admin Comms broadcast now mirrors each Postgres `admin_user_messages` row into Firestore `notifications/{id}` (type `system`). Mobile `Messages → Notifications` already listens to that collection.

## Deploy deps (not in AAB alone)

1. **Cloud Run / blyp-live-service** — needs this commit so `POST /admin/comms/broadcast` writes Firestore inbox docs.
2. **Firestore rules** — `firestore.rules` now allows users to read their own `notifications` and mark `status: read`. Deploy rules if prod does not already allow this.

## Verify

1. Deploy backend (+ rules if needed).
2. Open admin.blyp.world → Comms → send a short broadcast to `active` (or yourself via segment).
3. On device (AAB or debug): open **Messages → Notifications**.
4. Expect title/body/timestamp; tap marks read; optional deep link opens if set.

## Files

- `backend/blyp-live-service/src/admin/firestoreAdmin.ts` — `enqueueAdminInboxNotification(s)`
- `backend/blyp-live-service/src/admin/adminInsights.ts` — broadcast fan-out mirror
- `backend/blyp-live-service/src/admin/adminService.ts` — direct message mirror
- `admin/src/pages/Comms.tsx` — honest delivered copy
- `src/screens/MessengerScreen.js` — deep link + unread badge
- `firestore.rules` — notifications read/mark-read
