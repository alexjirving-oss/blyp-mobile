# Dating UX revision

## Before

- Discovery was a small avatar card with four equal-weight action buttons.
- Likes received were not surfaced, even though `datingLikes` already allowed the recipient to read them.
- Matches were a plain list and mutual likes ended in a system alert.
- Empty states and profile setup were functional but did not guide the next useful action.
- The surface inherited generic cards and the main teal accent without a distinct Dating identity.

## Shipped

- Rebuilt Dating around four clear loops: **Discover, Likes, Matches, Profile**.
- Added a dark editorial Blyp identity with teal signal color and a warm coral Dating accent; no purple clone treatment.
- Made discovery photo-led, including existing multi-photo refs, distance context, profile prompts, tap-through photos, swipe/pass/like motion, haptics, and visible safety actions.
- Surfaced pending incoming likes from the existing `datingLikes` collection. Likes already answered, passed, blocked, or matched are removed from the pending view.
- Added a real mutual-match moment with direct Messenger entry, plus richer match rows and first-message guidance.
- Reworked all empty, loading, subscription, age-gate, hidden-profile, and caught-up states around a useful next step.
- Reframed preferences as profile strength, card preview, visibility, intro, prompts, identity, age, interest, distance, location, and safety controls.
- Kept the existing Cloud Function write path for like/pass and the existing Messenger thread path.

## Verification

- Targeted ESLint: pass.
- TypeScript project typecheck: pass.
- Dating service tests: 3 suites, 8 tests passed.
- No AAB bake and no version change were performed.

## Next

1. Add first-class Dating photo management for the existing `photoRefs` field instead of relying on profile/admin-populated refs.
2. Move likes and matches to live listeners so connection badges update without a manual refresh.
3. Validate swipe thresholds, compact-height layouts, haptics, and screen-reader order on physical Android and iOS devices before the combined release bake.
