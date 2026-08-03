import { createContext } from "react";
import type { AdminSession } from "../api/client";

export interface AuthContextValue {
  session: AdminSession | null;
  isAuthed: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
