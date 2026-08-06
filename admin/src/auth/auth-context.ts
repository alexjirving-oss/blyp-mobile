import { createContext } from "react";
import type { AdminSession } from "../api/client";
import type { CognitoTokens } from "./cognito";
import type { AdminMe, AdminPermission, AdminRole } from "./permissions";

export interface AuthContextValue {
  session: AdminSession | null;
  isAuthed: boolean;
  me: AdminMe | null;
  meLoading: boolean;
  role: AdminRole | null;
  permissions: AdminPermission[];
  can: (permission: AdminPermission) => boolean;
  refreshMe: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  /** Finish SOFTWARE_TOKEN_MFA / SMS_MFA after CognitoMfaRequiredError. */
  completeMfa: (
    completeMfaFn: (otpCode: string) => Promise<CognitoTokens>,
    otpCode: string
  ) => Promise<void>;
  logout: () => void;
}

/** Single shared context — must be the same object AuthProvider and useAuth use. */
export const AuthContext = createContext<AuthContextValue | null>(null);
