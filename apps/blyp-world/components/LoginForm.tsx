"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";

export function LoginForm() {
  const { login, session, logout } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (session) {
    return (
      <div className="max-w-md space-y-4">
        <p className="text-[var(--blyp-muted)]">
          Signed in as{" "}
          <span className="text-[var(--blyp-fog)]">
            {session.email || session.username}
          </span>
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => router.push("/foryou")}
            className="rounded-full bg-[var(--blyp-teal)] px-5 py-2.5 text-sm font-semibold text-[var(--blyp-ink)]"
          >
            Open For You
          </button>
          <button
            type="button"
            onClick={logout}
            className="rounded-full border border-[var(--blyp-line)] px-5 py-2.5 text-sm font-semibold"
          >
            Log out
          </button>
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
      router.push("/foryou");
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
    <form onSubmit={onSubmit} className="max-w-md space-y-4">
      <p className="text-sm text-[var(--blyp-muted)]">
        Same Cognito pool as the Blyp app (
        <span className="text-[var(--blyp-fog)]">eu-west-2_ITX07Zvnt</span>).
      </p>
      <label className="block">
        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.18em] text-[var(--blyp-muted)]">
          Email
        </span>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-xl border border-[var(--blyp-line)] bg-[var(--blyp-ink-elevated)] px-4 py-3 text-[var(--blyp-fog)] outline-none ring-[var(--blyp-teal)] focus:ring-2"
        />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.18em] text-[var(--blyp-muted)]">
          Password
        </span>
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-xl border border-[var(--blyp-line)] bg-[var(--blyp-ink-elevated)] px-4 py-3 text-[var(--blyp-fog)] outline-none ring-[var(--blyp-teal)] focus:ring-2"
        />
      </label>
      {error ? (
        <p className="text-sm text-[var(--blyp-rose)]" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={busy}
        className="rounded-full bg-[var(--blyp-teal)] px-6 py-3 text-sm font-semibold text-[var(--blyp-ink)] disabled:opacity-60"
      >
        {busy ? "Signing in…" : "Log in"}
      </button>
    </form>
  );
}
