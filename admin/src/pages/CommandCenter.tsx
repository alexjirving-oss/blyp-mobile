import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useAsync } from "../lib/useAsync";
import { fmtNum, fmtRelative } from "../lib/format";
import { PageHeader, StatCard, Spinner, ErrorNote, Badge, WarnNote, Skeleton } from "../components/ui";
import type { MetricsOverview, OpsControlPlane, UserSourceStats } from "../types";

export default function CommandCenter() {
  const metrics = useAsync<MetricsOverview>(() => api.get<MetricsOverview>("/admin/metrics/overview"), []);
  const sources = useAsync<UserSourceStats>(() => api.get<UserSourceStats>("/admin/users/sources"), []);
  const health = useAsync<{ status?: string; ok?: boolean }>(() => api.health(), []);
  const control = useAsync<OpsControlPlane>(() => api.get<OpsControlPlane>("/admin/ops/control-plane"), []);

  const m = metrics.data;
  const degraded = m?.degraded;
  const w = control.data?.withdrawals;

  return (
    <div>
      <PageHeader
        title="Command Center"
        subtitle="Ops snapshot — health, money readiness, safety posture"
        actions={
          <button className="btn ghost tiny" onClick={() => { metrics.reload(); sources.reload(); health.reload(); control.reload(); }}>
            Refresh
          </button>
        }
      />

      {metrics.loading && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card"><Skeleton height={48} /></div>
          ))}
        </div>
      )}
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

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12, marginTop: 16 }}>
        <div className="card">
          <h3 className="panel-title">Backend health</h3>
          {health.loading && <Spinner />}
          {health.error && <ErrorNote>Unreachable: {health.error}</ErrorNote>}
          {health.data && (
            <div className="row" style={{ gap: 10 }}>
              <Badge kind={health.data.ok || health.data.status === "ok" ? "ok" : "warn"}>
                {health.data.ok || health.data.status === "ok" ? "Operational" : "Degraded"}
              </Badge>
              <span className="muted" style={{ fontSize: 12 }}>Cloud Run</span>
            </div>
          )}
        </div>
        <div className="card">
          <h3 className="panel-title">Withdrawals</h3>
          {control.loading && <Skeleton height={28} />}
          {w && (
            <>
              <Badge kind={w.effectivelyEnabled ? "ok" : "err"}>
                {w.effectivelyEnabled ? "LIVE" : "DISABLED"}
              </Badge>
              <div className="dim" style={{ fontSize: 12, marginTop: 8 }}>{w.note}</div>
              <Link className="btn ghost tiny" style={{ marginTop: 10, display: "inline-flex" }} to="/economy">Open Economy</Link>
            </>
          )}
        </div>
        <div className="card">
          <h3 className="panel-title">Streaming kill-switch</h3>
          {control.data && (
            <>
              <Badge kind={control.data.killSwitches.streamingEnabled === false ? "err" : "ok"}>
                {control.data.killSwitches.streamingEnabled === null
                  ? "Unset"
                  : control.data.killSwitches.streamingEnabled
                    ? "Enabled"
                    : "Killed"}
              </Badge>
              <Link className="btn ghost tiny" style={{ marginTop: 10, display: "inline-flex" }} to="/config">Configuration</Link>
            </>
          )}
        </div>
        <div className="card">
          <h3 className="panel-title">Child safety</h3>
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>Open the war-room lane for P0 reports.</p>
          <Link className="btn danger tiny" to="/safety?lane=child_safety">War room</Link>
        </div>
      </div>

      {!w?.effectivelyEnabled && w && (
        <div style={{ marginTop: 14 }}>
          <WarnNote>
            Creator cash-out is not live. Empty withdrawal queues are expected. Do not brief creators that payouts work.
          </WarnNote>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16, marginTop: 18 }} className="cc-grid">
        <div className="card">
          <h3 className="panel-title">User identity sources</h3>
          <p className="muted" style={{ marginTop: -6, fontSize: 12 }}>
            Directory (Cognito) is source of truth; others are derived activity tables.
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
            <h3 className="panel-title">Quick ops</h3>
            <div className="stack" style={{ gap: 8 }}>
              <Link to="/people" className="btn ghost tiny">People search</Link>
              <Link to="/live" className="btn ghost tiny">Live directory</Link>
              <Link to="/safety" className="btn ghost tiny">Report queue</Link>
              <Link to="/growth" className="btn ghost tiny">Growth + rankings</Link>
              <Link to="/access" className="btn ghost tiny">Audit feed</Link>
            </div>
          </div>
          <div className="card">
            <h3 className="panel-title">Data freshness</h3>
            <div className="muted" style={{ fontSize: 13 }}>
              Metrics {m ? fmtRelative(m.generatedAt) : "—"}.
              Control plane {control.data ? fmtRelative(control.data.generatedAt) : "—"}.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
