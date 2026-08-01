import { ApiError } from '../platform/apiContract';

export type PostLifecycleState =
  | 'draft'
  | 'pending_review'
  | 'published'
  | 'restricted'
  | 'rejected'
  | 'removed';

const ALLOWED_TRANSITIONS: Readonly<Record<PostLifecycleState, ReadonlySet<PostLifecycleState>>> = {
  draft: new Set(['pending_review', 'published', 'removed']),
  pending_review: new Set(['published', 'restricted', 'rejected', 'removed']),
  published: new Set(['restricted', 'removed']),
  restricted: new Set(['published', 'rejected', 'removed']),
  rejected: new Set(['pending_review', 'removed']),
  removed: new Set(),
};

export function canTransitionPostState(
  currentState: PostLifecycleState,
  nextState: PostLifecycleState
): boolean {
  return currentState !== nextState && ALLOWED_TRANSITIONS[currentState].has(nextState);
}

export function assertPostStateTransition(
  currentState: PostLifecycleState,
  nextState: PostLifecycleState
): void {
  if (!canTransitionPostState(currentState, nextState)) {
    throw new ApiError(409, 'CONTENT_STATE_TRANSITION_INVALID', 'The requested post state transition is not permitted.', {
      currentState,
      nextState,
    });
  }
}

export function isPublicPostState(state: PostLifecycleState): boolean {
  return state === 'published';
}

export function isAuthorEditablePostState(state: PostLifecycleState): boolean {
  return state === 'draft' || state === 'pending_review' || state === 'published' || state === 'restricted';
}

export function moderationTransitions(): Record<PostLifecycleState, PostLifecycleState[]> {
  return Object.fromEntries(
    Object.entries(ALLOWED_TRANSITIONS).map(([state, targets]) => [state, [...targets]])
  ) as Record<PostLifecycleState, PostLifecycleState[]>;
}
