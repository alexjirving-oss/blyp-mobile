# For You — ground-up design (TikTok-class)

**Scope:** For You feed only. LIVE untouched. No storm Exo-pool patches. No bake.

**Bar:** Swipe ~2/sec; every settled video plays immediately with audio from t=0.

---

## 1. One path

```
ForYouScreen
  → ForYouPager (vertical pager, window ±1)
    → ForYouSlide (one post)
      → ForYouPlayer (sole production player)
```

No `FeedPlayer` / storm theater / expo-av fallback on this path. If native module missing in prod → hard fail with visible error (dev may show a stub banner).

---

## 2. Player model

| Role | Count | Behavior |
|------|-------|----------|
| **Active** | 1 | Attached to settled index; playing; audio on; position forced to 0 on become-active |
| **Warm** | up to 2 (±1) | Prepared / buffered; paused; muted; same URL policy as active |
| **Cold** | rest | No player / released |

**Engine:** One dedicated native player stack for For You (Android Exo/Media3 or iOS AVPlayer via a **new** thin native module / RN surface), not the storm shared pool.

**Lifecycle per slide:**
1. Mount in window → `prepare(url)` (progressive preferred)
2. Become active → `seek(0)` → `play()` + unmute (or set volume) in one turn
3. Leave active → `pause()` + mute; keep warm if still ±1
4. Leave window → `release()`

**Seek-to-0:** Always on activate (and on URL bind). Never resume mid-clip from a previous visit unless product later opts in; default is t=0 every settle.

---

## 3. URL policy (progressive-first, never dead `startUrl`)

Resolve in order; **skip empty / 404 / non-playable**:

1. `progressiveUrl` / `mp4Url` / `downloadUrl` (direct progressive)
2. `hlsUrl` only if no progressive and HLS is known-good for the item
3. Else **omit slide from playable set** or show non-player placeholder — **never** pass a dead `startUrl`, placeholder CDN stub, or storm “maybe later” URL into the player

Feed item contract for For You:

```ts
type ForYouPlayable = {
  id: string;
  progressiveUrl: string; // required for autoplay path
  posterUrl?: string;
  // hlsUrl optional; not used for first paint if progressive exists
};
```

Resolver returns `null` → slide does not call `prepare`. No silent black frames from bad URLs.

---

## 4. Warm neighbors

- Window: `activeIndex - 1 .. activeIndex + 1` (configurable; default 1).
- Warm players: `prepare` + buffer; **paused + muted**.
- On swipe settle: previous active → warm (or release if outside window); target warm → active with seek-0 + play + audio.
- Target: prepare latency hidden so settle→first-frame+audio ≤ one frame budget at ~2 swipes/sec when neighbor was warm.

---

## 5. Audio from t=0 (no AVAudioSession steal)

- For You owns a **feed playback audio session** only while the For You tab is focused and a slide is active.
- **Do not** call APIs that steal / deactivate other apps’ sessions aggressively beyond standard playback category.
- **Do not** route through LIVE or storm session helpers that set `.playback` + options that interrupt LIVE or vice versa incorrectly — LIVE has its own path; For You must not import LIVE audio session code.
- iOS: use playback category appropriate for muted-warm / unmuted-active without toggling session on every warm prepare.
- Android: focus request only when becoming active + unmuted; abandon on blur / leave For You.
- Warm neighbors stay muted so focus isn’t fought across three players.

---

## 6. Explicit non-goals / removals on For You path

| Storm / legacy | Action on For You |
|----------------|-------------------|
| `FeedPlayer` theater / Exo pool binding | **Hard-disable** import & render; For You never mounts it |
| Storm shared player pool warm/steal | **Not used**; do not patch |
| expo-av `Video` on production For You | **Removed** from path; no fallback |
| Dead `startUrl` / storm URL guessing | **Replaced** by progressive-first resolver |
| LIVE player / agora / stage | **Leave alone** |

Storm code may remain in repo for other surfaces; For You simply does not call it.

---

## 7. Module layout (clean)

```
src/feed/                       # sole For You playback package
  DESIGN.md
  index.js                      # barrel
  ForYouVideo.js                # RN cell host (no expo-av, no FeedPlayer)
  ForYouEngine.js               # active / warm / cold roles
  forYouPlayerController.js     # promote/demote + seek-to-0
  forYouAudio.js                # FY-only audible ownership (no LIVE steal path)
  resolvePlayableUri.js         # progressive-first URL policy
  ShortsNative.js               # BlypShorts bridge (not storm pool)
```

Wire HomeScreen For You cells through `PremiumFeedVideo` → `ForYouVideo` only.

---

## 8. Success checks (device later; unit now)

- Unit: URL resolver never returns empty/dead startUrl; prefers progressive.
- Unit: controller promote/demote keeps ≤1 active, ≤2 warm, seek-0 on promote.
- Manual (post-bake, out of scope here): 2/sec swipe, audio from 0, no LIVE regression.

---

## 9. Implementation order

1. This doc (done).
2. `forYouUrl` + controller + tests.
3. `ForYouPlayer` RN surface + hard cutover of For You route away from storm `FeedPlayer`.
4. Checkpoint note + test results.
