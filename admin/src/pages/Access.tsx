import { useAuth } from "../auth/useAuth";
import { fmtDate } from "../lib/format";
import { PageHeader, Badge } from "../components/ui";
import AuditFeed from "../components/AuditFeed";

export default function Access() {
  const { session } = useAuth();
  return (
    <div>
      <PageHeader title="Access & Security" subtitle="Cognito admin sessions, allowlist, and the full audit trail" />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 18 }}>
        <div className="card">
          <h3 className="panel-title">Current session</h3>
          <div className="row spread" style={{ marginBottom: 8 }}>
            <span className="muted" style={{ fontSize: 13 }}>Signed in as (Cognito sub)</span>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{session?.actorUserId}</span>
          </div>
          <div className="row spread" style={{ marginBottom: 8 }}>
            <span className="muted" style={{ fontSize: 13 }}>Auth</span>
            <Badge kind="info">Cognito Bearer</Badge>
          </div>
          <div className="row spread">
            <span className="muted" style={{ fontSize: 13 }}>Token expires</span>
            <span style={{ fontSize: 13 }}>{fmtDate(session ? new Date(session.expiresAt).toISOString() : null)}</span>
          </div>
        </div>
        <div className="card">
          <h3 className="panel-title">How admin access works</h3>
          <ul style={{ margin: 0, paddingLeft: 18, color: "var(--text-2)", fontSize: 13, lineHeight: 1.8 }}>
            <li>Console: <code>https://admin.blyp.world</code></li>
            <li>Sign in with your Cognito email/password (MFA if enabled)</li>
            <li>Backend allowlist: <code>ADMIN_ALLOWLIST_SUBS</code> (Cognito subs on Cloud Run)</li>
            <li>Shared password / <code>ADMIN_LOGIN_ACCOUNTS</code> login is retired</li>
            <li>In-app admin (mobile) is separate: set Role to admin/manager on a user to sync their Firestore user doc</li>
          </ul>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18, maxWidth: 720 }}>
        <h3 className="panel-title">Hardening backlog</h3>
        <ul style={{ margin: 0, paddingLeft: 18, color: "var(--text-2)", fontSize: 13, lineHeight: 1.8 }}>
          <li>Per-module role permissions (owner / admin / moderator)</li>
          <li>Active session list with remote revoke</li>
          <li>Freeze <code>isAdmin</code> / <code>roles</code> on client-writable Firestore user docs (see README honest limits)</li>
        </ul>
      </div>

      <div className="card">
        <h3 className="panel-title">Audit log</h3>
        <p className="muted" style={{ marginTop: -6, fontSize: 12 }}>Every administrative action, newest first. Click a user row to open their profile.</p>
        <AuditFeed />
      </div>
    </div>
  );
}
