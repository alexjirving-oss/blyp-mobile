"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  loadStoredSession,
  refreshSessionIfNeeded,
  signInWithPassword,
  signOutLocal,
  type BlypSession,
} from "@/lib/cognito";
import { ensureFirebaseFromCognito } from "@/lib/firebaseBridge";
import { loadMeProfile, type MeProfile } from "@/lib/profile";

type AuthContextValue = {
  session: BlypSession | null;
  me: MeProfile | null;
  loading: boolean;
  firebaseReady: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  requireAuth: (reason?: string) => boolean;
  gateReason: string | null;
  clearGate: () => void;
  refreshMe: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function bridgeAndProfile(
  session: BlypSession,
): Promise<{ firebaseReady: boolean; me: MeProfile | null }> {
  const firebaseReady = await ensureFirebaseFromCognito({
    cognitoIdToken: session.idToken,
    uid: session.sub,
  });
  // users/userProfiles are publicly readable — still refresh after bridge for consistency.
  const me = await loadMeProfile(session.sub, session.username);
  return { firebaseReady, me };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<BlypSession | null>(null);
  const [me, setMe] = useState<MeProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [firebaseReady, setFirebaseReady] = useState(false);
  const [gateReason, setGateReason] = useState<string | null>(null);

  const refreshMe = useCallback(async () => {
    if (!session?.sub) {
      setMe(null);
      return;
    }
    const profile = await loadMeProfile(session.sub, session.username);
    setMe(profile);
  }, [session?.sub, session?.username]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const stored = loadStoredSession();
      const fresh = await refreshSessionIfNeeded(stored);
      if (!alive) return;
      setSession(fresh);
      if (fresh?.idToken && fresh.sub) {
        const { firebaseReady: ready, me: profile } = await bridgeAndProfile(fresh);
        if (!alive) return;
        setFirebaseReady(ready);
        setMe(profile);
      } else {
        setFirebaseReady(false);
        setMe(null);
      }
      if (!alive) return;
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // economyFetch may force-refresh Cognito after a live-service 401 and
  // persist a new idToken — keep React session in sync so header/wallet
  // polls do not keep sending the dead JWT.
  useEffect(() => {
    const onSession = (ev: Event) => {
      const next = (ev as CustomEvent<BlypSession | null>).detail;
      setSession(next);
      if (!next?.idToken) {
        setMe(null);
        setFirebaseReady(false);
      }
    };
    window.addEventListener("blyp:session", onSession);
    return () => window.removeEventListener("blyp:session", onSession);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const next = await signInWithPassword(email, password);
    const { firebaseReady: ready, me: profile } = await bridgeAndProfile(next);
    setFirebaseReady(ready);
    setMe(profile);
    setSession(next);
    setGateReason(null);
  }, []);

  const logout = useCallback(() => {
    signOutLocal();
    setSession(null);
    setMe(null);
    setFirebaseReady(false);
  }, []);

  const requireAuth = useCallback(
    (reason?: string) => {
      if (session?.idToken) return false;
      setGateReason(reason || "Log in to continue");
      return true;
    },
    [session],
  );

  const value = useMemo(
    () => ({
      session,
      me,
      loading,
      firebaseReady,
      login,
      logout,
      requireAuth,
      gateReason,
      clearGate: () => setGateReason(null),
      refreshMe,
    }),
    [
      session,
      me,
      loading,
      firebaseReady,
      login,
      logout,
      requireAuth,
      gateReason,
      refreshMe,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth requires AuthProvider");
  return ctx;
}
