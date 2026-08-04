# SPEC — Blyp World-Class Live Broadcasting (V1)

## Objective
Ship a production-grade, TikTok-class interactive live experience using Amazon IVS Real-Time.
V1 prioritizes stability, correctness, and repeatable testing over breadth.

## Live Architecture (V1)
- Live mode: Interactive only (IVS Real-Time stage).
- No HLS playback / IVS Channels in V1. (Explicitly Phase 2.)
- Target: host + up to 8 on-screen guests; up to 100 total stage participants.

## Roles & Permissions
- Host:
	- Start/end live
	- Approve/deny guest requests
	- Invite guests
	- Promote/demote co-host
	- Mute/kick guests
	- Set live title/tags
- Co-host:
	- Moderate guests (mute/kick) if enabled by host
- Guest:
	- Request to join
	- Toggle mic/cam (if permitted)
- Viewer:
	- Join as non-broadcasting participant (receive-only mode in app logic)
	- Chat, react, send gifts
- Moderator:
	- Chat moderation actions, bans/timeouts, slow mode, keyword filters

## Core Features (Must Have V1)
1. Live Session lifecycle
	 - Host creates live session, joins stage, publishes audio/video.
	 - Viewers join the same stage in receive-only mode.
	 - Guests request to join; host approves; guest begins publishing.

2. Multi-Guest Layout
	 - Up to 8 guest tiles + host tile.
	 - Deterministic layout selection (grid) with active speaker highlight optional (Phase 1.5).

3. Host Controls
	 - Mute guest audio
	 - Disable guest camera
	 - Kick guest from stage
	 - Promote/demote co-host

4. Live Chat
	 - Real-time chat feed with moderation hooks.
	 - Basic anti-spam/slow-mode (mod controlled).

5. Reactions
	 - Lightweight like/reaction events (batched to reduce spam).

6. Gifts (Blyp economy)
	 - Gifts can be sent during live.
	 - Gift targets: host or a specific guest.
	 - Server-side ledger and receipt validation rules apply (no client-trust).
	 - Payout split is configurable server-side; default 50/50 platform/creator.
	 - Creator share goes to the targeted recipient’s wallet.

7. Overlays / Metadata
	 - Live title + tags visible to viewers.
	 - Host can update title/tags during live.

## Reliability (Must Have V1)
- Auto reconnect on transient disconnects:
	- UI shows reconnect state.
	- Backoff strategy.
	- Cleanly rebind local tracks and remote renderers after reconnect.
- Network degradation:
	- Auto fallback to audio-only (with clear UI).
	- Auto restore video when stable.
- No duplicate native view registrations.
- No “viewer sees video but host loses it” switching regression.

## Observability (Must Have V1)
- Structured logs for:
	- Stage join/leave
	- Publish/unpublish tracks
	- Remote track add/remove
	- Render attach/detach
	- Reconnect attempts/results
- Crash reporting hooks preserved (Sentry/Crashlytics if already wired).
- Debug screen/flag to dump IVS state snapshot.

## Non-Negotiables
- No placeholders / no fake stubs.
- No regressions to existing live flow.
- All changes must pass validation commands.
