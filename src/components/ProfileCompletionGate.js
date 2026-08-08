import React, { useEffect, useState } from 'react';
import { db } from '../config/firebase';
import ProfileCompletionScreen from '../screens/ProfileCompletionScreen';
import {
  claimUsername,
  clearPendingProfile,
  hasValidPublicUsername,
  isFederatedAuthUser,
  isUsernameDeferred,
  markUsernameDeferred,
  readPendingProfileForUser,
  usernameKey,
} from '../services/usernameProfileService';
import { snapData } from '../utils/firestoreSnap';

/**
 * Post-auth username helper.
 *
 * - Email/password: username is collected once on AuthScreen signup/verify.
 *   This gate only silently finishes that claim — never shows UI.
 * - Social (federated) missing a public handle: one optional prompt, then
 *   durable deferral so cold start / re-sign-in never re-nags.
 * - Never blocks the app behind a loading spinner.
 */
export default function ProfileCompletionGate({ uid, user, children }) {
  const [socialPrompt, setSocialPrompt] = useState(null);

  useEffect(() => {
    if (!uid) return undefined;
    let active = true;
    setSocialPrompt(null);

    const run = async () => {
      const attributes = user?.attributes || {};
      const email = String(attributes.email || user?.email || '').trim().toLowerCase();
      const photoURL = String(attributes.picture || user?.photoURL || '').trim();

      try {
        const [pending, deferred, snap] = await Promise.all([
          readPendingProfileForUser({ email }),
          isUsernameDeferred(uid),
          db.collection('users').doc(uid).get(),
        ]);
        if (!active) return;

        let profile = snapData(snap) || {};
        const currentUsername = profile.username || profile.handle || '';

        if (hasValidPublicUsername(profile, uid)) {
          if (pending) await clearPendingProfile().catch(() => {});
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
              '[AUTH][PROFILE_GATE] pending claim failed; will not overlay email path',
              error?.code || error?.message || error,
            );
            await clearPendingProfile().catch(() => {});
            // Fall through — social may still get one-time UI; email stays silent.
          }
        }

        // Already skipped once — never re-prompt on later launches / sign-ins.
        if (deferred) {
          await clearPendingProfile().catch(() => {});
          return;
        }

        // Social only: one-time optional @handle prompt.
        if (isFederatedAuthUser(user)) {
          if (!active) return;
          setSocialPrompt({
            email: profile.email || email || '',
            photoURL: profile.photoURL || photoURL || '',
            initialUsername: candidate || profile.suggestedUsername || '',
          });
          return;
        }

        // Email/password or legacy without a handle — never overlay; stop future nags.
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
  }, [uid, user?.email, user?.username, user?.userId, user?.attributes?.email, user?.attributes?.picture, user?.attributes?.identities, user?.photoURL]);

  if (socialPrompt) {
    return (
      <ProfileCompletionScreen
        uid={uid}
        initialUsername={socialPrompt.initialUsername}
        email={socialPrompt.email}
        photoURL={socialPrompt.photoURL}
        canSkip
        onComplete={() => setSocialPrompt(null)}
        onSkip={async () => {
          try {
            await markUsernameDeferred(uid);
            await clearPendingProfile();
          } catch {
            /* non-fatal */
          }
          setSocialPrompt(null);
        }}
      />
    );
  }

  return children;
}
