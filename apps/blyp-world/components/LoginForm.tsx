"use client";

import { Suspense, useMemo, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "./AuthProvider";
import "./login-gate.css";

function safeNextPath(raw: string | null): string {
  if (!raw) return "/";
  // Only same-origin relative paths (allow hash for /teams#apply).
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

function LoginFormInner() {
  const { login, session, logout } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = useMemo(
    () => safeNextPath(searchParams.get("next")),
    [searchParams],
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (session) {
    return (
      <div className="lgate">
        <div className="lgate-card">
          <p className="lgate-kicker">Signed in</p>
          <h2 className="lgate-title">You&apos;re in</h2>
          <p className="lgate-who">
            <strong>{session.email || session.username}</strong>
          </p>
          <div className="lgate-actions">
            <button
              type="button"
              onClick={() => router.push(nextPath)}
              className="lgate-go"
            >
              Continue
            </button>
            <button type="button" onClick={logout} className="lgate-ghost">
              Log out
            </button>
          </div>
        </div>
      </div>
    );
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      router.push(nextPath);
    } catch (err) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: string }).message)
          : "Login failed";
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lgate">
      <form onSubmit={onSubmit} className="lgate-card lgate-form">
        <p className="lgate-kicker">Same account as the app</p>
        <p className="lgate-copy">
          Email and password for your Blyp account. Keep watching free without
          signing in.
        </p>
        <label className="lgate-label">
          <span>Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="lgate-input"
          />
        </label>
        <label className="lgate-label">
          <span>Password</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="lgate-input"
          />
        </label>
        {error ? (
          <p className="lgate-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="lgate-actions">
          <button type="submit" disabled={busy} className="lgate-go">
            {busy ? "Signing in…" : "Log in"}
          </button>
        </div>
      </form>
    </div>
  );
}

export function LoginForm() {
  return (
    <Suspense fallback={<p className="lgate-fallback">Loading…</p>}>
      <LoginFormInner />
    </Suspense>
  );
}
