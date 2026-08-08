# Calls status

## Verdict

Calls are not safe to re-enable in this release. The transport and Android ringing stack are
mostly still present, but the user-facing call session was deliberately replaced by a
`Coming soon` screen and all call entry points were hard-disabled. This release leaves Calls
off while shipping the Messages fixes.

There is currently no Calls feature flag. The disablement is hard-coded in three places.

## Why Calls was disabled

Two consecutive changes on 4 August 2026 explain the current state:

- `764f54f3` added Android `ConnectionService`/incoming-call chrome and direct call FCM, but
  replaced the 700+ line LiveKit `CallScreen` with `Coming soon`.
- `b0da3682` then removed startup LiveKit global registration, the foreground incoming-call
  watcher, push routing into `CallScreen`, call creation/history from `MessengerScreen`, and
  the call button from conversations. The stated goal was a lighter application shell.

This was therefore an intentional shutdown rather than a missing tab or a single regression.

## What remains

- `src/services/callService.js`: microphone permission, call creation/status transitions,
  token minting, and call subscriptions.
- `src/services/messaging/messengerExtrasService.js`: Firestore call documents, call history,
  and incoming-ringing subscriptions.
- `functions/src/calls/livekit.ts`: authenticated LiveKit token mint and direct high-priority
  incoming-call FCM with outbox fallback.
- `src/services/notifySound.js`: shared ringtone/audio routing.
- Android native incoming-call activity, foreground ringtone service, FCM service,
  notification actions, and Telecom `ConnectionService`.
- LiveKit/WebRTC dependencies and Expo config plugins.
- Firestore participant rules for `calls/{callId}`.
- Navigation still registers `CallScreen`, but that screen only shows `Coming soon`.

## Blockers

1. The working LiveKit session UI only exists in git history (`764f54f3^`). It needs to be
   restored and reviewed against the newer messaging and Expo 54 code before release.
2. `registerGlobals()` was removed from app startup. It should be registered lazily when the
   call screen mounts to preserve the shell-performance goal.
3. Incoming push routing and the foreground Firestore watcher are disabled in `App.js`.
   Re-enabling both requires deduplication so one call cannot ring or navigate twice.
4. Conversation and Calls-tab call buttons were removed. Restoring only the tab would expose
   history without a dependable active-call path.
5. Production deployment/configuration is not proven here: `mintLiveKitToken` and
   `onCallCreate` must be deployed, and `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and
   `LIVEKIT_API_SECRET` must be configured. Secrets must never be placed in the client.
6. Firestore call updates currently preserve participants/caller/callee but do not restrict
   all other changed fields. Tighten updates to an allowlist of status/timestamp/end fields
   before exposing call creation broadly.
7. The last full screen defaulted speakerphone on even though the later accountability
   contract expected earpiece by default. Audio routing needs two-device Android validation.
8. No end-to-end test currently proves caller ring, locked-device answer/decline, LiveKit
   audio in both directions, reconnect, timeout/missed status, and hang-up cleanup.

## Safe re-enable plan

1. Add one remotely overridable `callsEnabled` flag, default off until production validation.
   Use it for the conversation button, Calls tab, push route, foreground watcher, and screen.
2. Restore the pre-`764f54f3` `CallScreen`, move `registerGlobals()` into its mount path, default
   to earpiece, and retain the native service as the single incoming ringtone owner.
3. Tighten Firestore update rules and add emulator tests for legal and illegal transitions.
4. Verify deployed Functions and LiveKit configuration without logging secret values.
5. Test on two physical Android devices, including background and locked-screen flows.
6. Turn the flag on for internal testers, inspect crash/connection telemetry, then enable
   production only after the acceptance matrix passes.

## Recommended product state

Keep the Calls tab labeled `Coming soon` for this urgent Messages release. Restore Calls in a
dedicated build after the security rule and two-device acceptance work above; the retained
stack makes that restoration practical, but it is not a safe one-line toggle.
