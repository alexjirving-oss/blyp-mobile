import React, { useEffect } from 'react';
import { db } from '../config/firebase';
import {
  claimUsername,
  clearPendingProfile,
  hasValidPublicUsername,
  markUsernameDeferred,
  readPendingProfileForUser,
  usernameKey,
} from '../services/usernameProfileService';
import { snapData } from '../utils/firestoreSnap';

/**
 * Post-auth username helper — NEVER a blocking UI.
 *
 * Username is collected once during AuthScreen email signup (and claimed on
 * verify). This component only silently finishes that claim if needed.
 *
 * It must never show a username completion screen on cold start, sign-in, or
 * app reopen. Returning users with a handle see zero username UI. Accounts
 * still missing a handle are marked deferred so nothing can re-nag later;
 * they can set a handle in Edit Profile.
 */
export default function ProfileCompletionGate({ uid, user, children }) {
  useEffect(() => {
    if (!uid) return undefined;
    let active = true;

    const run = async () => {
      const attributes = user?.attributes || {};
      const email = String(attributes.email || user?.email || '').trim().toLowerCase();
      const photoURL = String(attributes.picture || user?.photoURL || '').trim();

      try {
        const [pending, snap] = await Promise.all([
          readPendingProfileForUser({ email }),
          db.collection('users').doc(uid).get(),
        ]);
        if (!active) return;

        let profile = snapData(snap) || {};
        const currentUsername = profile.username || profile.handle || '';

        // Already has a real public handle — clear leftover signup pending and exit.
        if (hasValidPublicUsername(profile, uid)) {
          if (pending) await clearPendingProfile().catch(() => {});
          // Backfill usernameKey quietly when missing; never wipe username on failure.
          if (currentUsername && profile.usernameKey !== usernameKey(currentUsername)) {
            try {
              await claimUsername({
                uid,
                username: currentUsername,
                email: profile.email || email || undefined,
                photoURL: profile.photoURL || photoURL || undefined,
              });
            } catch (error) {
              console.warn(
                '[AUTH][PROFILE_GATE] usernameKey backfill skipped',
                error?.code || error?.message || error,
              );
            }
          }
          return;
        }

        // Finish signup-chosen handle in the background (no overlay).
        const candidate = String(pending?.username || '').trim();
        if (candidate) {
          try {
            await claimUsername({
              uid,
              username: candidate,
              email: profile.email || email || undefined,
              photoURL: profile.photoURL || photoURL || undefined,
            });
            return;
          } catch (error) {
            console.warn(
              '[AUTH][PROFILE_GATE] pending claim failed; will not overlay',
              error?.code || error?.message || error,
            );
            await clearPendingProfile().catch(() => {});
          }
        }

        // No handle and nothing left to claim — permanently stop any future nag.
        await markUsernameDeferred(uid).catch(() => {});
        await clearPendingProfile().catch(() => {});
      } catch (error) {
        console.warn('[AUTH][PROFILE_GATE] silent pass failed', error?.message || error);
      }
    };

    run();
    return () => {
      active = false;
    };
  }, [uid, user?.email, user?.attributes?.email, user?.attributes?.picture, user?.photoURL]);

  // Always render the app. Never block on username UI or a loading spinner.
  return children;
}
