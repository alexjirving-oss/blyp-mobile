import { useAuth } from "../auth/useAuth";
import { fmtDate } from "../lib/format";
import { PageHeader, Badge } from "../components/ui";
import AuditFeed from "../components/AuditFeed";

export default function Access() {
  const { session } = useAuth();
  return (
    <div>
      <PageHeader title="Access & Security" subtitle="Admin accounts, roles, and the full audit trail" />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 18 }}>
        <div className="card">
          <h3 className="panel-title">Current session</h3>
          <div className="row spread" style={{ marginBottom: 8 }}>
            <span className="muted" style={{ fontSize: 13 }}>Signed in as</span>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{session?.actorUserId}</span>
          </div>
          <div className="row spread" style={{ marginBottom: 8 }}>
            <span className="muted" style={{ fontSize: 13 }}>Role</span>
            <Badge kind="info">owner</Badge>
          </div>
          <div className="row spread">
            <span className="muted" style={{ fontSize: 13 }}>Session expires</span>
            <span style={{ fontSize: 13 }}>{fmtDate(session ? new Date(session.expiresAt).toISOString() : null)}</span>
          </div>
        </div>
        <div className="card">
          <h3 className="panel-title">Hardening roadmap</h3>
          <ul style={{ margin: 0, paddingLeft: 18, color: "var(--text-2)", fontSize: 13, lineHeight: 1.8 }}>
            <li>Replace the shared login with individual admin accounts</li>
            <li>Per-module role permissions (owner / admin / moderator)</li>
            <li>Two-factor authentication</li>
            <li>Active session list with remote revoke</li>
          </ul>
        </div>
      </div>

      <div className="card">
        <h3 className="panel-title">Audit log</h3>
        <p className="muted" style={{ marginTop: -6, fontSize: 12 }}>Every administrative action, newest first. Click a user row to open their profile.</p>
        <AuditFeed />
      </div>
    </div>
  );
}
