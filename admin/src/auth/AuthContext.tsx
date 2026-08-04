import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  loadSession,
  clearSession,
  login as apiLogin,
  completeMfaLogin,
  type AdminSession,
} from "../api/client";
import type { CognitoTokens } from "./cognito";

interface AuthContextValue {
  session: AdminSession | null;
  isAuthed: boolean;
  login: (email: string, password: string) => Promise<void>;
  /** Finish SOFTWARE_TOKEN_MFA / SMS_MFA after CognitoMfaRequiredError. */
  completeMfa: (
    completeMfaFn: (otpCode: string) => Promise<CognitoTokens>,
    otpCode: string
  ) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AdminSession | null>(() => loadSession());

  useEffect(() => {
    const onStorage = () => setSession(loadSession());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      isAuthed: !!session,
      login: async (email, password) => {
        const s = await apiLogin(email, password);
        setSession(s);
      },
      completeMfa: async (completeMfaFn, otpCode) => {
        const s = await completeMfaLogin(completeMfaFn, otpCode);
        setSession(s);
      },
      logout: () => {
        clearSession();
        setSession(null);
      },
    }),
    [session]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Hook co-located with provider is intentional for this auth module.
// eslint-disable-next-line react-refresh/only-export-components -- useAuth pairs with AuthProvider
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
