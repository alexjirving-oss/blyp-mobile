import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { db } from '../config/firebase';
import ProfileCompletionScreen from '../screens/ProfileCompletionScreen';
import {
  claimUsername,
  clearPendingProfile,
  hasValidPublicUsername,
  isUsernameDeferred,
  markUsernameDeferred,
  readPendingProfileForUser,
  usernameKey,
} from '../services/usernameProfileService';
import { snapData } from '../utils/firestoreSnap';
import { COLORS } from '../styles/theme';

const RETRY_DELAYS = [0, 500, 1500, 3000];

/**
 * Post-auth username gate.
 * - New email signups claim their @handle during AuthScreen's success handler,
 *   so this gate is a no-op for them (profile is already complete on first render).
 * - Social / legacy accounts missing a public @handle see the overlay once until
 *   they complete it or defer it — deferral is persisted so it never re-nags on
 *   every launch.
 */
export default function ProfileCompletionGate({ uid, user, children }) {
  const [state, setState] = useState({
    loading: true,
    profile: null,
    pending: null,
    deferred: false,
    loadFailed: false,
  });

  useEffect(() => {
    let active = true;
    setState({
      loading: true,
      profile: null,
      pending: null,
      deferred: false,
      loadFailed: false,
    });

    const load = async () => {
      const attributes = user?.attributes || {};
      const email = String(attributes.email || user?.email || '').trim().toLowerCase();
      const photoURL = String(attributes.picture || user?.photoURL || '').trim();
      const [pending, deferred] = await Promise.all([
        readPendingProfileForUser({ email }),
        isUsernameDeferred(uid),
      ]);

      let lastError = null;
      for (const delay of RETRY_DELAYS) {
        if (!active) return;
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
        try {
          const snap = await db.collection('users').doc(uid).get();
          if (!active) return;
          let profile = snapData(snap) || {};
          const currentUsername = profile.username || profile.handle || '';

          // Silent claim from a signup/social pending username — never shows an overlay.
          if (!hasValidPublicUsername(profile, uid)) {
            const candidate = pending?.username || '';
            if (candidate) {
              try {
                const claimed = await claimUsername({
                  uid,
                  username: candidate,
                  email: profile.email || email || undefined,
                  photoURL: profile.photoURL || photoURL || undefined,
                });
                profile = {
                  ...profile,
                  username: claimed.username,
                  handle: claimed.username,
                  usernameKey: claimed.usernameKey,
                };
              } catch (claimError) {
                if (claimError?.code === 'USERNAME_TAKEN') {
                  profile = {
                    ...profile,
                    username: null,
                    handle: null,
                    suggestedUsername: candidate,
                  };
                } else {
                  console.warn(
                    '[AUTH][PROFILE_GATE] pending username claim deferred',
                    claimError?.message || claimError,
                  );
                }
              }
            }
          } else if (profile.usernameKey !== usernameKey(currentUsername)) {
            try {
              const claimed = await claimUsername({
                uid,
                username: currentUsername,
                email: profile.email || email || undefined,
                photoURL: profile.photoURL || photoURL || undefined,
              });
              profile = { ...profile, ...claimed, handle: claimed.username };
            } catch (claimError) {
              if (claimError?.code === 'USERNAME_TAKEN') {
                profile = {
                  ...profile,
                  username: null,
                  handle: null,
                  suggestedUsername: currentUsername,
                };
              } else {
                console.warn(
                  '[AUTH][PROFILE_GATE] legacy username migration deferred',
                  claimError?.message || claimError,
                );
              }
            }
          }

          setState({ loading: false, profile, pending, deferred, loadFailed: false });
          return;
        } catch (error) {
          lastError = error;
        }
      }
      console.warn('[AUTH][PROFILE_GATE] profile check failed', lastError?.message || lastError);
      if (active) {
        setState({ loading: false, profile: {}, pending, deferred, loadFailed: true });
      }
    };

    if (uid) load();
    return () => {
      active = false;
    };
  }, [uid, user]);

  const identity = useMemo(() => {
    const attributes = user?.attributes || {};
    return {
      email: state.profile?.email || attributes.email || user?.email || '',
      photoURL: state.profile?.photoURL || attributes.picture || user?.photoURL || '',
    };
  }, [state.profile, user]);
  const profileComplete = hasValidPublicUsername(state.profile, uid);
  // A signup-chosen username that failed to silently claim (e.g. taken) must be
  // resolved — everything else (legacy/social with no handle) can be deferred.
  const allowSkip = !state.pending?.username;

  useEffect(() => {
    if (profileComplete && state.pending) {
      clearPendingProfile().catch(() => {});
    }
  }, [profileComplete, state.pending]);

  if (!uid) return children;
  if (state.loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={COLORS.primary} size="large" />
      </View>
    );
  }
  if (profileComplete) return children;
  // Don't block the app on a flaky profile fetch — retry next cold start.
  if (state.loadFailed && !state.pending?.username) return children;
  // Legacy / social account missing a @handle: durable one-time deferral, never
  // re-prompt on every launch.
  if (state.deferred) return children;

  return (
    <ProfileCompletionScreen
      uid={uid}
      initialUsername={state.pending?.username || state.profile?.suggestedUsername || ''}
      email={identity.email}
      photoURL={identity.photoURL}
      canSkip={allowSkip}
      onComplete={(result) => {
        setState((current) => ({
          ...current,
          pending: null,
          deferred: false,
          profile: {
            ...(current.profile || {}),
            username: result.username,
            handle: result.username,
            usernameKey: result.usernameKey,
          },
        }));
      }}
      onSkip={async () => {
        try {
          await markUsernameDeferred(uid);
          await clearPendingProfile();
        } catch {
          /* non-fatal */
        }
        setState((current) => ({ ...current, deferred: true, pending: null }));
      }}
    />
  );
}

const styles = StyleSheet.create({
  loading: {
    alignItems: 'center',
    backgroundColor: COLORS.pageBackground,
    flex: 1,
    justifyContent: 'center',
  },
});
