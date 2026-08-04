// guestSessionService.js
//
// Lightweight "browse as guest" session. A guest has NO Cognito/Firebase
// identity (uid is null) but is allowed past the auth gate so they can browse,
// search and watch. Any action that creates data or spends money is blocked via
// `requireAccount()` and routed to sign-up.
//
// State lives both in-memory (synchronous reads for render paths) and in
// AsyncStorage (survives reloads). Subscribe with `useGuestMode()`.

import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'blyp.guestMode.v1';

let guestMode = false;
let hydrated = false;
const listeners = new Set();

function notify() {
  for (const l of Array.from(listeners)) {
    try { l(guestMode); } catch { }
  }
}

export function getGuestMode() {
  return guestMode;
}

export function isGuestHydrated() {
  return hydrated;
}

// Read persisted flag once at boot. Safe to call repeatedly.
export async function loadGuestMode() {
  try {
    const v = await AsyncStorage.getItem(STORAGE_KEY);
    guestMode = v === '1';
  } catch {
    guestMode = false;
  } finally {
    hydrated = true;
    notify();
  }
  return guestMode;
}

export async function enterGuestMode() {
  guestMode = true;
  hydrated = true;
  try { await AsyncStorage.setItem(STORAGE_KEY, '1'); } catch { }
  notify();
}

export async function exitGuestMode() {
  guestMode = false;
  try { await AsyncStorage.removeItem(STORAGE_KEY); } catch { }
  notify();
}

// React subscriber. Returns the current guest flag and re-renders on change.
export function useGuestMode() {
  const [val, setVal] = useState(guestMode);
  useEffect(() => {
    const l = (next) => setVal(next);
    listeners.add(l);
    // Sync immediately in case the flag changed before subscribe.
    setVal(guestMode);
    if (!hydrated) { loadGuestMode().catch(() => { }); }
    return () => { listeners.delete(l); };
  }, []);
  return val;
}

// Gate a guest-restricted action. Returns true when the action was BLOCKED
// (caller should bail out). For signed-in users it always returns false.
//
// `navigation` is optional; when provided, "Sign up" exits guest mode so the
// app drops back to the AuthScreen (the auth gate re-renders automatically).
export function requireAccount(navigation, actionLabel = 'do that') {
  if (!guestMode) return false;
  Alert.alert(
    'Sign up to continue',
    `You're browsing as a guest. Create a free account to ${actionLabel}.`,
    [
      { text: 'Not now', style: 'cancel' },
      {
        text: 'Sign up',
        onPress: () => {
          // Leaving guest mode flips the auth gate back to the sign-in screen.
          exitGuestMode().catch(() => { });
        },
      },
    ]
  );
  return true;
}
