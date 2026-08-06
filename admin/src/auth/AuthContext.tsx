import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  loadSession,
  clearSession,
  login as apiLogin,
  completeMfaLogin,
  api,
  type AdminSession,
} from "../api/client";
import { AuthContext, type AuthContextValue } from "./auth-context";
import { can as canPerm, type AdminMe, type AdminPermission, type AdminRole } from "./permissions";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AdminSession | null>(() => loadSession());
  const [me, setMe] = useState<AdminMe | null>(null);
  const [meLoading, setMeLoading] = useState(false);

  const refreshMe = useCallback(async () => {
    const s = loadSession();
    if (!s) {
      setMe(null);
      return;
    }
    setMeLoading(true);
    try {
      const data = await api.get<AdminMe>("/admin/auth/me");
      setMe(data);
    } catch {
      setMe(null);
    } finally {
      setMeLoading(false);
    }
  }, []);

  useEffect(() => {
    const onStorage = () => setSession(loadSession());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (session) {
      void refreshMe();
    } else {
      setMe(null);
    }
  }, [session, refreshMe]);

  const permissions = me?.permissions || [];
  const role = (me?.role as AdminRole | undefined) || null;

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      isAuthed: !!session,
      me,
      meLoading,
      role,
      permissions,
      can: (permission: AdminPermission) => canPerm(permissions, permission),
      refreshMe,
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
        setMe(null);
      },
    }),
    [session, me, meLoading, role, permissions, refreshMe]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export { useAuth } from "./useAuth";
