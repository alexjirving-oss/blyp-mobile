# 🎬 Live Streaming Architecture Diagram

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          BLYP LIVE STREAMING                              │
│                     Google Play Store Compliant                          │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────┐                    ┌─────────────────────────┐
│    BROADCASTER PHONE    │                    │     VIEWER PHONE(S)     │
│     (Going Live)        │                    │   (Watching Stream)     │
└───────────┬─────────────┘                    └───────────┬─────────────┘
            │                                               │
            │  ┌────────────────────────────────────────┐  │
            │  │  1. CAMERA RECORDING (3-sec segments) │  │
            │  │     Uses: Expo Camera API              │  │
            │  └────────────┬───────────────────────────┘  │
            │               │                               │
            │               ▼                               │
            │  ┌────────────────────────────────────────┐  │
            │  │  2. SEGMENT UPLOAD                     │  │
            │  │     To: Firebase Storage               │  │
            │  │     File: segment_0.mp4, segment_1.mp4 │  │
            │  └────────────┬───────────────────────────┘  │
            │               │                               │
            │               ▼                               │
            │  ┌────────────────────────────────────────┐  │
            │  │  3. FIRESTORE UPDATE                   │  │
            │  │     Document: liveStreams/{streamId}   │  │
            │  │     Field: segments.0.url, ...         │  │
            │  └────────────┬───────────────────────────┘  │
            │               │                               │
            │               │  [FIREBASE CLOUD]             │
            │               │  ┌─────────────────────┐     │
            │               └─▶│  Firestore Database │     │
            │                  │  + Storage CDN      │─────┤
            │                  └─────────────────────┘     │
            │                             │                 │
            │                             │ Real-time       │
            │                             │ Notification    │
            │                             ▼                 │
            │                  ┌─────────────────────┐     │
            │                  │  4. VIEWER NOTIFIED │◀────┘
            │                  │     Via: onSnapshot  │
            │                  └──────────┬──────────┘
            │                             │
            │                             ▼
            │                  ┌─────────────────────┐
            │                  │  5. SEGMENT DOWNLOAD│
            │                  │     From: Storage   │
            │                  └──────────┬──────────┘
            │                             │
            │                             ▼
            │                  ┌─────────────────────┐
            │                  │  6. VIDEO PLAYBACK  │
            │                  │     Uses: Expo Video│
            │                  └─────────────────────┘


═══════════════════════════════════════════════════════════════════════════

## Data Flow Diagram

BROADCASTER FLOW:
═══════════════

Start Stream
    │
    ▼
┌────────────────┐
│ Setup Screen   │  Title: "My Stream"
│                │  Description: "Live coding!"
└───────┬────────┘  Thumbnail: [image]
        │
        ▼ (Tap "Go Live")
┌────────────────┐
│ Camera Opens   │  Facing: Front
│                │  Quality: 720p
└───────┬────────┘  Audio: On
        │
        ▼ (Every 3 seconds)
┌────────────────┐
│ Record Segment │  File: temp_segment.mp4
│                │  Duration: 3 seconds
└───────┬────────┘  Size: ~1MB
        │
        ▼ (Background upload)
┌────────────────┐
│ Upload to      │  Path: streams/user123/live_456/segment_0.mp4
│ Firebase       │  URL: https://firebasestorage.../segment_0.mp4
└───────┬────────┘
        │
        ▼
┌────────────────┐
│ Update         │  liveStreams/abc123:
│ Firestore      │    currentSegment: 0
└───────┬────────┘    segments.0.url: "https://..."
        │
        └─────▶ (Loop: Record next segment)


VIEWER FLOW:
═══════════

Join Stream
    │
    ▼
┌────────────────┐
│ Subscribe to   │  Listen to: liveStreams/{streamId}
│ Stream Updates │  Real-time: onSnapshot()
└───────┬────────┘
        │
        ▼ (When new segment available)
┌────────────────┐
│ Notification:  │  Event: { currentSegment: 0, segments: {...} }
│ New Segment!   │  
└───────┬────────┘
        │
        ▼
┌────────────────┐
│ Add to Queue   │  Queue: [segment_0, segment_1, ...]
│                │  
└───────┬────────┘
        │
        ▼
┌────────────────┐
│ Download       │  Fetch: segment_0.url
│ Segment        │  From: Firebase Storage CDN
└───────┬────────┘
        │
        ▼
┌────────────────┐
│ Play Video     │  Player: Expo Video
│                │  Auto-advance to next segment
└───────┬────────┘
        │
        └─────▶ (Wait for next segment notification)


═══════════════════════════════════════════════════════════════════════════

## Firebase Structure

FIRESTORE:
═════════

liveStreams/
    ├─ {streamId}/
    │   ├─ userId: "user123"
    │   ├─ title: "My Live Stream"
    │   ├─ status: "live"
    │   ├─ currentSegment: 42
    │   ├─ viewCount: 125
    │   ├─ likeCount: 87
    │   ├─ segments:
    │   │   ├─ 0: { url: "https://...", uploadedAt: timestamp }
    │   │   ├─ 1: { url: "https://...", uploadedAt: timestamp }
    │   │   └─ 2: { url: "https://...", uploadedAt: timestamp }
    │   ├─ comments/
    │   │   └─ {commentId}/
    │   │       ├─ userId: "viewer456"
    │   │       ├─ content: "Great stream!"
    │   │       └─ createdAt: timestamp
    │   └─ likes/
    │       └─ {userId}/
    │           └─ timestamp: timestamp


STORAGE:
═══════

streams/
    └─ {userId}/
        └─ live_{timestamp}/
            ├─ segment_0.mp4
            ├─ segment_1.mp4
            ├─ segment_2.mp4
            └─ ...


═══════════════════════════════════════════════════════════════════════════

## Component Architecture

┌─────────────────────────────────────────────────────────────┐
│                    LiveStreamScreen.js                       │
│                  (Main UI Container)                         │
│                                                              │
│  ┌────────────────────────┐   ┌───────────────────────────┐│
│  │  Setup Mode            │   │  Live Mode                ││
│  │  (Before going live)   │   │  (During stream)          ││
│  │                        │   │                           ││
│  │  - Title input         │   │  ┌─────────────────────┐ ││
│  │  - Description input   │   │  │ If isCreator:       │ ││
│  │  - Thumbnail picker    │   │  │ LiveStreamBroadcaster│││
│  │  - "Go Live" button    │   │  │ (Camera + Upload)   │ ││
│  └────────────────────────┘   │  └─────────────────────┘ ││
│                                │                           ││
│                                │  ┌─────────────────────┐ ││
│                                │  │ If !isCreator:      │ ││
│                                │  │ LiveStreamViewer    │ ││
│                                │  │ (Video Player)      │ ││
│                                │  └─────────────────────┘ ││
│                                │                           ││
│                                │  - Comments section       ││
│                                │  - Like button            ││
│                                │  - View count             ││
│                                └───────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
                          │
          ┌───────────────┴───────────────┐
          │                               │
          ▼                               ▼
┌─────────────────────┐         ┌─────────────────────┐
│ LiveStreamBroadcaster│        │  LiveStreamViewer   │
│                      │         │                     │
│ - Camera preview     │         │ - Video player      │
│ - Recording loop     │         │ - Segment queue     │
│ - Segment upload     │         │ - Buffering         │
│ - Flip camera        │         │ - Auto-advance      │
└─────────┬────────────┘         └──────────┬──────────┘
          │                                  │
          └──────────────┬───────────────────┘
                         │
                         ▼
              ┌───────────────────────┐
              │ HLSLiveStreamService  │
              │                       │
              │ - createStream()      │
              │ - uploadSegment()     │
              │ - endStream()         │
              │ - subscribeToStream() │
              │ - addComment()        │
              │ - toggleLike()        │
              └───────────────────────┘


═══════════════════════════════════════════════════════════════════════════

## Timeline Example

TIME    BROADCASTER                    FIREBASE                VIEWER
════    ═══════════                    ════════               ══════

00:00   Press "Go Live"                Create stream doc      -
        │                              Status: "live"
        ▼
00:00   Camera opens                   -                      -
        Start recording
        │
        ▼
00:03   Segment 0 complete             Upload segment_0.mp4   -
        Upload starts...               URL generated
        │                              │
        ▼                              ▼
00:04   Recording segment 1            Update: segments.0     Viewer joins
        │                              │                      │
        │                              │                      ▼
        │                              │                      Subscribe to stream
        │                              │                      │
        │                              │                      ▼
        │                              │                      Notification: segment 0
        │                              │                      │
        │                              │                      ▼
        │                              │                      Download segment 0
        │                              │                      │
        │                              │                      ▼
        ▼                              ▼                      Play segment 0
00:06   Segment 1 uploaded             Update: segments.1     │
        Recording segment 2            │                      │
        │                              │                      ▼
        │                              │                      Notification: segment 1
        │                              │                      │
        │                              │                      ▼
00:07   Recording segment 3            -                      Download segment 1
        │                              │                      Segment 0 finishes
        │                              │                      │
        │                              │                      ▼
        │                              │                      Play segment 1
        ▼                              ▼                      ▼
[...]   Continue...                    Continue...            Continue...

        (Seamless loop)                (Real-time updates)    (Smooth playback)


═══════════════════════════════════════════════════════════════════════════

## Why This Works

✅ SCALABILITY
   - Firebase CDN distributes to unlimited viewers
   - No P2P connections to manage
   - Automatic load balancing

✅ RELIABILITY
   - Firebase 99.9% uptime SLA
   - CDN edge caching worldwide
   - Automatic retry on failures

✅ LATENCY
   - 3-second segments = 3-5 second total latency
   - Much better than traditional HLS (10-30s)
   - Real-time Firestore notifications

✅ SIMPLICITY
   - Standard HTTP video delivery
   - No complex signaling protocols
   - Works on all devices/networks

✅ COST-EFFECTIVE
   - Pay only for what you use
   - No server maintenance
   - Efficient CDN pricing

═══════════════════════════════════════════════════════════════════════════
