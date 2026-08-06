import { useState } from "react";
import { Link } from "react-router-dom";
import { api, getApiBase } from "../api/client";
import { useAsync } from "../lib/useAsync";
import { fmtRelative } from "../lib/format";
import { PageHeader, Spinner, ErrorNote, Badge, WarnNote, InfoNote } from "../components/ui";
import { useToast } from "../components/Toast";
import type { MetricsOverview, OpsControlPlane, BanCacheResponse } from "../types";

type HealthResponse = {
  ok?: boolean;
  status?: string;
  ready?: boolean;
};

export default function Ops() {
  const toast = useToast();
  const health = useAsync<HealthResponse>(() => api.health(), []);
  const metrics = useAsync<MetricsOverview>(() => api.get<MetricsOverview>("/admin/metrics/overview"), []);
  const control = useAsync<OpsControlPlane>(() => api.get<OpsControlPlane>("/admin/ops/control-plane"), []);
  const [probeUserId, setProbeUserId] = useState("");
  const [probeKey, setProbeKey] = useState(0);
  const banCache = useAsync<BanCacheResponse>(
    () =>
      api.get<BanCacheResponse>(
        `/admin/ops/ban-cache${probeUserId.trim() ? `?userId=${encodeURIComponent(probeUserId.trim())}` : ""}`,
      ),
    [probeKey],
  );

  const healthy = health.data && (health.data.ok || health.data.status === "ok");
  const dbOk = metrics.data && !metrics.data.degraded;
  const w = control.data?.withdrawals;
  const bc = control.data?.banCache || banCache.data?.stats;

  return (
    <div>
      <PageHeader
        title="System & Ops"
        subtitle="Service health, control plane, ban-cache verification"
        actions={
          <button
            className="btn ghost tiny"
            onClick={() => {
              health.reload();
              metrics.reload();
              control.reload();
              setProbeKey((k) => k + 1);
            }}
          >
            Refresh
          </button>
        }
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

        <div className="card">
          <h3 className="panel-title">Withdrawals kill-switch</h3>
          {control.loading && <Spinner />}
          {control.error && <ErrorNote>{control.error}</ErrorNote>}
          {w && (
            <>
              <Badge kind={w.effectivelyEnabled ? "ok" : "err"}>{w.effectivelyEnabled ? "LIVE" : "OFF"}</Badge>
              <div className="dim" style={{ fontSize: 12, marginTop: 8 }}>{w.note}</div>
            </>
          )}
        </div>

        <div className="card">
          <h3 className="panel-title">Streaming flag</h3>
          {control.data && (
            <Badge kind={control.data.killSwitches.streamingEnabled === false ? "err" : "ok"}>
              {control.data.killSwitches.streamingEnabled === null
                ? "Unset"
                : control.data.killSwitches.streamingEnabled
                  ? "Enabled"
                  : "Killed"}
            </Badge>
          )}
          <Link className="btn ghost tiny" style={{ marginTop: 10, display: "inline-flex" }} to="/config">Manage in Config</Link>
        </div>

        <div className="card">
          <h3 className="panel-title">Ban cache (this instance)</h3>
          {bc ? (
            <>
              <Badge kind="info">{bc.size} entries</Badge>
              <div className="dim" style={{ fontSize: 12, marginTop: 8 }}>TTL {bc.ttlMs}ms · fail-open on DB miss: {String(bc.failOpenOnDbMiss)}</div>
            </>
          ) : (
            <Spinner />
          )}
        </div>
      </div>

      {w && !w.effectivelyEnabled && (
        <div style={{ marginTop: 14 }}>
          <WarnNote>
            Payouts are disabled at the env layer. Queue UIs remain honest — do not brief creators that cash-out works.
          </WarnNote>
        </div>
      )}

      <div className="card stack" style={{ marginTop: 16, maxWidth: 720 }}>
        <h3 className="panel-title">Ban-cache probe</h3>
        <InfoNote>
          Compares Postgres <code>user_admin_state</code> vs this Cloud Run instance&apos;s in-process Map, then refreshes the cache entry.
        </InfoNote>
        <div className="row" style={{ gap: 8 }}>
          <input
            className="grow"
            value={probeUserId}
            onChange={(e) => setProbeUserId(e.target.value)}
            placeholder="Cognito sub to probe"
          />
          <button
            className="btn tiny"
            onClick={() => {
              setProbeKey((k) => k + 1);
              toast.push("Probe refreshed", "info");
            }}
          >
            Probe
          </button>
        </div>
        {banCache.loading && <Spinner />}
        {banCache.error && <ErrorNote>{banCache.error}</ErrorNote>}
        {banCache.data?.probe && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 13 }}>
            <div>DB banned: <strong>{String(banCache.data.probe.dbBanned)}</strong></div>
            <div>Cached: <strong>{String(banCache.data.probe.cachedBanned)}</strong></div>
            <div>Cache hit (before refresh): <strong>{String(banCache.data.probe.cacheHit)}</strong></div>
            <div>
              In sync:{" "}
              <Badge kind={banCache.data.probe.inSync === false ? "err" : banCache.data.probe.inSync ? "ok" : "neutral"}>
                {String(banCache.data.probe.inSync)}
              </Badge>
            </div>
            {banCache.data.probe.detail && <div className="dim">{banCache.data.probe.detail}</div>}
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 16, maxWidth: 720 }}>
        <h3 className="panel-title">Auth posture</h3>
        <InfoNote>
          Admin APIs require Cognito Bearer + <code>ADMIN_ALLOWLIST_SUBS</code>. Empty allowlist fails closed.
          Password login and <code>x-admin-session</code> are retired.
        </InfoNote>
      </div>
    </div>
  );
}
