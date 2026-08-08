import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { db } from '../config/firebase';
import ProfileCompletionScreen from '../screens/ProfileCompletionScreen';
import {
  clearPendingProfile,
  hasValidPublicUsername,
  readPendingProfile,
} from '../services/usernameProfileService';
import { snapData } from '../utils/firestoreSnap';
import { COLORS } from '../styles/theme';

const RETRY_DELAYS = [0, 500, 1500, 3000];

export default function ProfileCompletionGate({ uid, user, children }) {
  const [state, setState] = useState({ loading: true, profile: null, pending: null });
  const [skipped, setSkipped] = useState(false);

  useEffect(() => {
    let active = true;
    setSkipped(false);
    setState({ loading: true, profile: null, pending: null });

    const load = async () => {
      const pending = await readPendingProfile();
      let lastError = null;
      for (const delay of RETRY_DELAYS) {
        if (!active) return;
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
        try {
          const snap = await db.collection('users').doc(uid).get();
          if (!active) return;
          setState({ loading: false, profile: snapData(snap) || {}, pending });
          return;
        } catch (error) {
          lastError = error;
        }
      }
      console.warn('[AUTH][PROFILE_GATE] profile check failed', lastError?.message || lastError);
      if (active) setState({ loading: false, profile: {}, pending });
    };

    if (uid) load();
    return () => {
      active = false;
    };
  }, [uid]);

  const identity = useMemo(() => {
    const attributes = user?.attributes || {};
    return {
      email: state.profile?.email || attributes.email || user?.email || '',
      photoURL: state.profile?.photoURL || attributes.picture || user?.photoURL || '',
    };
  }, [state.profile, user]);
  const profileComplete = hasValidPublicUsername(state.profile, uid);

  useEffect(() => {
    if (profileComplete && state.pending) {
      clearPendingProfile().catch(() => {});
    }
  }, [profileComplete, state.pending]);

  if (!uid || skipped) return children;
  if (state.loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={COLORS.primary} size="large" />
      </View>
    );
  }
  if (profileComplete) return children;

  return (
    <ProfileCompletionScreen
      uid={uid}
      initialUsername={state.pending?.username || ''}
      email={identity.email}
      photoURL={identity.photoURL}
      canSkip={!state.pending}
      onComplete={(result) => {
        setState((current) => ({
          ...current,
          pending: null,
          profile: {
            ...(current.profile || {}),
            username: result.username,
            handle: result.username,
            usernameKey: result.usernameKey,
          },
        }));
      }}
      onSkip={() => setSkipped(true)}
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
