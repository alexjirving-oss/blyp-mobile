import { api, getApiBase } from "../api/client";
import { useAsync } from "../lib/useAsync";
import { fmtRelative } from "../lib/format";
import { PageHeader, Spinner, ErrorNote, Badge } from "../components/ui";
import type { MetricsOverview } from "../types";

type HealthResponse = {
  ok?: boolean;
  status?: string;
  ready?: boolean;
};

export default function Ops() {
  const health = useAsync<HealthResponse>(() => api.health(), []);
  const metrics = useAsync<MetricsOverview>(() => api.get<MetricsOverview>("/admin/metrics/overview"), []);

  const healthy = health.data && (health.data.ok || health.data.status === "ok");
  const dbOk = metrics.data && !metrics.data.degraded;

  return (
    <div>
      <PageHeader
        title="System & Ops"
        subtitle="Service health and infrastructure"
        actions={<button className="btn ghost tiny" onClick={() => { health.reload(); metrics.reload(); }}>Refresh</button>}
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
        <div className="card">
          <h3 className="panel-title">API service</h3>
          {health.loading && <Spinner />}
          {health.error && <ErrorNote>Unreachable: {health.error}</ErrorNote>}
          {health.data && (
            <div className="row" style={{ gap: 10 }}>
              <Badge kind={healthy ? "ok" : "warn"}>{healthy ? "Operational" : "Degraded"}</Badge>
              <span className="dim" style={{ fontSize: 11 }}>Cloud Run</span>
            </div>
          )}
          <div className="dim mono" style={{ fontSize: 11, marginTop: 10, wordBreak: "break-all" }}>{getApiBase()}</div>
        </div>

        <div className="card">
          <h3 className="panel-title">Database</h3>
          {metrics.loading && <Spinner />}
          {metrics.data && (
            <>
              <Badge kind={dbOk ? "ok" : "err"}>{dbOk ? "Connected" : "Degraded"}</Badge>
              {metrics.data.degraded && <div className="dim" style={{ fontSize: 11, marginTop: 8 }}>{metrics.data.detail}</div>}
              {dbOk && <div className="dim" style={{ fontSize: 11, marginTop: 8 }}>Checked {fmtRelative(metrics.data.generatedAt)}</div>}
            </>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16, maxWidth: 720 }}>
        <h3 className="panel-title">Coming next</h3>
        <ul style={{ margin: 0, paddingLeft: 18, color: "var(--text-2)", fontSize: 13.5, lineHeight: 1.9 }}>
          <li>Live error rate & latency from Cloud Run metrics</li>
          <li>Structured log search & alerting</li>
          <li>Uptime history and incident timeline</li>
          <li>Redis / queue depth & socket connection counts</li>
        </ul>
      </div>
    </div>
  );
}
