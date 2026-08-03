import { useEffect, useMemo, useState, type ReactNode } from "react";
import { loadSession, clearSession, login as apiLogin } from "../api/client";
import { AuthContext, type AuthContextValue } from "./auth-context";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState(() => loadSession());

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
      logout: () => {
        clearSession();
        setSession(null);
      },
    }),
    [session]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
