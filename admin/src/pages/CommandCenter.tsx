import { api } from "../api/client";
import { useAsync } from "../lib/useAsync";
import { fmtNum, fmtRelative } from "../lib/format";
import { PageHeader, StatCard, Spinner, ErrorNote, Badge } from "../components/ui";
import type { MetricsOverview, UserSourceStats } from "../types";

export default function CommandCenter() {
  const metrics = useAsync<MetricsOverview>(() => api.get<MetricsOverview>("/admin/metrics/overview"), []);
  const sources = useAsync<UserSourceStats>(() => api.get<UserSourceStats>("/admin/users/sources"), []);
  const health = useAsync<{ status?: string; ok?: boolean }>(() => api.health(), []);

  const m = metrics.data;
  const degraded = m?.degraded;

  return (
    <div>
      <PageHeader
        title="Command Center"
        subtitle="Live snapshot of the platform"
        actions={
          <button className="btn ghost tiny" onClick={() => { metrics.reload(); sources.reload(); health.reload(); }}>
            Refresh
          </button>
        }
      />

      {metrics.loading && <Spinner label="Loading metrics…" />}
      {metrics.error && <ErrorNote>{metrics.error}</ErrorNote>}
      {degraded && <ErrorNote>Backend reports degraded data: {m?.detail || "database not ready"}</ErrorNote>}

      {m && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12, marginTop: 6 }}>
          <StatCard label="Total Users" value={fmtNum(m.totalUsers)} hint="Cognito directory + activity" />
          <StatCard label="Active" value={fmtNum(m.activeUsers ?? m.totalUsers - m.bannedUsers)} tone="ok" />
          <StatCard label="Banned" value={fmtNum(m.bannedUsers)} tone={m.bannedUsers > 0 ? "warn" : undefined} />
          <StatCard label="Coin Supply" value={fmtNum(m.totalCoinSupply)} hint="Wallet + bonus balances" />
          <StatCard label="Gifts · 24h" value={fmtNum(m.gifts24h)} />
          <StatCard label="Ledger · 24h" value={fmtNum(m.ledgerEntries24h)} hint="Economy transactions" />
          <StatCard label="Active Subs" value={fmtNum(m.activeSubscriptions)} />
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16, marginTop: 18 }}>
        <div className="card">
          <h3 className="panel-title">User identity sources</h3>
          <p className="muted" style={{ marginTop: -6, fontSize: 12 }}>
            Where Blyp knows about users. The directory (Cognito) is the source of truth; the others are derived activity tables.
          </p>
          {sources.loading && <Spinner />}
          {sources.error && <ErrorNote>{sources.error}</ErrorNote>}
          {sources.data && (
            <div className="table-wrap" style={{ maxHeight: 360 }}>
              <table>
                <thead>
                  <tr><th>Source</th><th>Table</th><th style={{ textAlign: "right" }}>Distinct users</th></tr>
                </thead>
                <tbody>
                  {sources.data.counts.map((c) => (
                    <tr key={c.source}>
                      <td className="mono">{c.source}</td>
                      <td>{c.exists ? c.table : <span className="dim">{c.table} (absent)</span>}</td>
                      <td style={{ textAlign: "right" }}>{c.error ? <Badge kind="err">err</Badge> : fmtNum(c.distinctUsers ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="stack">
          <div className="card">
            <h3 className="panel-title">Backend health</h3>
            {health.loading && <Spinner />}
            {health.error && <ErrorNote>Unreachable: {health.error}</ErrorNote>}
            {health.data && (
              <div className="row" style={{ gap: 10 }}>
                <Badge kind={health.data.ok || health.data.status === "ok" ? "ok" : "warn"}>
                  {health.data.ok || health.data.status === "ok" ? "Operational" : "Degraded"}
                </Badge>
                <span className="muted" style={{ fontSize: 12 }}>blyp-live-service · Cloud Run</span>
              </div>
            )}
          </div>
          <div className="card">
            <h3 className="panel-title">Data freshness</h3>
            <div className="muted" style={{ fontSize: 13 }}>
              Metrics generated {m ? fmtRelative(m.generatedAt) : "—"}.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
