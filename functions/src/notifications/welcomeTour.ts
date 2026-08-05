/**
 * Welcome tour notification — seeded when a user first completes onboarding.
 *
 * Trigger: users/{uid} write where blyp.prefs.onboarded flips false→true.
 * Idempotent via dedupeKey welcome_tour:{uid}.
 */

import * as functions from 'firebase-functions';
import { initFirebaseAdmin } from '../firebaseAdmin';
import { enqueueNotification } from './outbox';

export const onUserOnboardedWelcomeTour = functions.firestore
  .document('users/{uid}')
  .onWrite(async (change, context) => {
    initFirebaseAdmin();

    const uid = String(context.params.uid || '').trim();
    if (!uid) return null;

    const before = change.before.exists ? (change.before.data() as any) : null;
    const after = change.after.exists ? (change.after.data() as any) : null;
    if (!after) return null;

    const wasOnboarded = !!before?.blyp?.prefs?.onboarded;
    const isOnboarded = !!after?.blyp?.prefs?.onboarded;
    if (!isOnboarded || wasOnboarded) return null;

    // Already finished the tour on another device — still seed inbox item only
    // if they haven't completed; skip if tourCompleted is already true.
    if (after?.blyp?.prefs?.tourCompleted) return null;

    try {
      await enqueueNotification({
        userId: uid,
        type: 'system',
        title: 'Welcome to Blyp',
        body: 'Take a quick tour of Home, Create, Live, Messages, and more.',
        dedupeKey: `welcome_tour:${uid}`,
        collapseKey: `welcome_tour:${uid}`,
        data: {
          type: 'tour',
          action: 'start',
        },
      });
    } catch (e) {
      console.warn(
        '[welcomeTour] enqueue failed',
        uid,
        (e as any)?.message || String(e)
      );
    }

    return null;
  });
