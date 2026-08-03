import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="row spread wrap" style={{ marginBottom: 18, gap: 12 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>{title}</h1>
        {subtitle && <div className="muted" style={{ marginTop: 4, fontSize: 13 }}>{subtitle}</div>}
      </div>
      {actions && <div className="row wrap" style={{ gap: 8 }}>{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: "ok" | "warn" | "err" }) {
  const color = tone === "ok" ? "var(--success)" : tone === "warn" ? "var(--warning)" : tone === "err" ? "var(--error)" : "var(--text)";
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1, color }}>{value}</div>
      {hint && <div className="dim" style={{ fontSize: 11, marginTop: 8 }}>{hint}</div>}
    </div>
  );
}

export function Badge({ kind, children }: { kind: "ok" | "warn" | "err" | "info" | "neutral"; children: ReactNode }) {
  return <span className={`badge ${kind}`}>{children}</span>;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="row" style={{ gap: 10, color: "var(--text-2)", fontSize: 13, padding: "12px 0" }}>
      <span className="spinner" /> {label || "Loading…"}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="dim" style={{ padding: 24, textAlign: "center", fontSize: 13 }}>{children}</div>;
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(251,113,133,0.4)", background: "rgba(251,113,133,0.1)", color: "var(--error)", fontSize: 13 }}>
      {children}
    </div>
  );
}
