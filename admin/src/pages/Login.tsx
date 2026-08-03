import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { ErrorNote } from "../components/ui";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        background:
          "radial-gradient(900px 500px at 20% -10%, rgba(0,210,190,0.10), transparent 60%), radial-gradient(700px 500px at 110% 10%, rgba(103,232,249,0.06), transparent 55%), var(--bg)",
      }}
    >
      <form onSubmit={onSubmit} className="card" style={{ width: 380, padding: 28 }}>
        <div className="row" style={{ gap: 10, marginBottom: 4 }}>
          <span
            style={{
              display: "inline-flex",
              padding: "5px 12px 7px",
              borderRadius: 12,
              background: "linear-gradient(135deg, #00D2BE, #00A89E)",
              color: "#0A0A0C",
              fontWeight: 800,
              fontSize: 22,
            }}
          >
            Blyp
          </span>
          <span className="muted" style={{ fontSize: 13, fontWeight: 600, letterSpacing: "0.08em" }}>ADMIN</span>
        </div>
        <p className="muted" style={{ marginTop: 10, marginBottom: 22, fontSize: 13 }}>
          Sign in to your operating cockpit.
        </p>

        <div className="stack">
          <div>
            <label>Email</label>
            <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@blyp.live" required />
          </div>
          <div>
            <label>Password</label>
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required />
          </div>
          {error && <ErrorNote>{error}</ErrorNote>}
          <button className="btn" type="submit" disabled={busy} style={{ marginTop: 4 }}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </div>
      </form>
    </div>
  );
}
