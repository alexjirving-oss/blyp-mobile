# Preload / lag fixes (2026-08-06)

## What felt laggy
- For You: prefetch wrote React state (`prefetchedUris`) on every warm → FlatList thrash while decoding neighbors.
- Home hub: rails painted, then thumbs/avatars still cold on first scroll.
- MediaViewer: only warmed *next* clips; swipe-back hitch.
- Messages: conversation avatars fetched on bind with no disk warm.

## What changed
- `src/utils/mediaPrefetch.js` — deduped image/video warm queue, concurrency 3, `InteractionManager` for idle neighbors. Videos via `videoCache` (disk). Images via `Image.prefetch`. **No AV mute/play** (respects audio flicker fix `7717575`).
- For You / HomeScreen — disk-only ±2 (plus idle +3/+4); stable `renderItem`; removed `prefetchedUris` setState.
- HomeBase — rails still `Promise.all`; idle thumb/avatar prefetch after first paint; For You rail warms first posts.
- Following + MediaViewer — adjacent ±2 including previous; image posters too.
- Messenger — idle avatar prefetch on thread snapshot.

## Out of scope / safe
- No Gift cinema / sticky actions / Fold7 layout changes.
- `expo-image` not added (native Image.prefetch + video disk cache). Tip bake stays lean.

## Included tip AAB stack
- AI create-post `ebb8306`
- Play fold/edge/R8 `17980e8` (already on branch)
- This perf commit
- Wait for profile tab fixes (`_agent/PROFILE_TAB_FIXES_READY.md` / `fix(profile)`)
