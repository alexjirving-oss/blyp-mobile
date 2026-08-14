import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { CognitoMfaRequiredError } from "../api/client";
import { useAuth } from "../auth/useAuth";
import type { CognitoTokens } from "../auth/cognito";
import BlypWordmark from "../components/BlypWordmark";
import { ErrorNote } from "../components/ui";

export default function Login() {
  const { login, completeMfa } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [mfaPending, setMfaPending] = useState<null | {
    challengeName: string;
    complete: (code: string) => Promise<CognitoTokens>;
  }>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mfaPending) {
        await completeMfa(mfaPending.complete, otp);
        navigate("/");
        return;
      }
      await login(email.trim(), password);
      navigate("/");
    } catch (err) {
      if (err instanceof CognitoMfaRequiredError) {
        setMfaPending({ challengeName: err.challengeName, complete: err.completeMfa });
        setError(null);
      } else {
        setError(err instanceof Error ? err.message : "Login failed");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-shell">
      <form onSubmit={onSubmit} className="login-card">
        <div className="login-brand">
          <BlypWordmark size="lg" withTile />
          <span className="blyp-admin-badge">Admin</span>
        </div>
        <p className="muted" style={{ marginTop: 10, marginBottom: 22, fontSize: 13, lineHeight: 1.45 }}>
          {mfaPending
            ? `Enter your authenticator code (${mfaPending.challengeName}).`
            : "Sign in with Cognito (allowlisted admins only)."}
        </p>

        <div className="stack">
          {!mfaPending ? (
            <>
              <div>
                <label>Email</label>
                <input
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@blyp.live"
                  required
                />
              </div>
              <div>
                <label>Password</label>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                />
              </div>
            </>
          ) : (
            <div>
              <label>Authenticator code</label>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="123456"
                required
              />
            </div>
          )}
          {error && <ErrorNote>{error}</ErrorNote>}
          <button className="btn" type="submit" disabled={busy} style={{ marginTop: 4 }}>
            {busy ? "Signing in…" : mfaPending ? "Verify code" : "Sign in"}
          </button>
          {mfaPending && (
            <button
              type="button"
              className="btn"
              style={{ marginTop: 8, opacity: 0.7 }}
              disabled={busy}
              onClick={() => {
                setMfaPending(null);
                setOtp("");
                setError(null);
              }}
            >
              Back
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
