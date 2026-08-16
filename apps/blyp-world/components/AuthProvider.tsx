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

type AuthContextValue = {
  session: BlypSession | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  requireAuth: (reason?: string) => boolean;
  gateReason: string | null;
  clearGate: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<BlypSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [gateReason, setGateReason] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const stored = loadStoredSession();
      const fresh = await refreshSessionIfNeeded(stored);
      if (!alive) return;
      setSession(fresh);
      if (fresh?.idToken && fresh.sub) {
        void ensureFirebaseFromCognito({
          cognitoIdToken: fresh.idToken,
          uid: fresh.sub,
        });
      }
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const next = await signInWithPassword(email, password);
    setSession(next);
    setGateReason(null);
    await ensureFirebaseFromCognito({
      cognitoIdToken: next.idToken,
      uid: next.sub,
    });
  }, []);

  const logout = useCallback(() => {
    signOutLocal();
    setSession(null);
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
      loading,
      login,
      logout,
      requireAuth,
      gateReason,
      clearGate: () => setGateReason(null),
    }),
    [session, loading, login, logout, requireAuth, gateReason],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth requires AuthProvider");
  return ctx;
}
