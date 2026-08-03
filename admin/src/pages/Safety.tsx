import { useState } from "react";
import { api } from "../api/client";
import { useAsync } from "../lib/useAsync";
import { fmtNum } from "../lib/format";
import { PageHeader, StatCard, Spinner } from "../components/ui";
import AuditFeed from "../components/AuditFeed";
import type { MetricsOverview } from "../types";

const FILTERS: { key: string; label: string; action?: string }[] = [
  { key: "all", label: "All activity" },
  { key: "user_ban", label: "Bans", action: "user_ban" },
  { key: "user_capabilities_set", label: "Restrictions", action: "user_capabilities_set" },
  { key: "post_remove", label: "Post removals", action: "post_remove" },
];

export default function Safety() {
  const metrics = useAsync<MetricsOverview>(() => api.get<MetricsOverview>("/admin/metrics/overview"), []);
  const [filter, setFilter] = useState("all");
  const m = metrics.data;
  const active = FILTERS.find((f) => f.key === filter);

  return (
    <div>
      <PageHeader title="Trust & Safety" subtitle="Enforcement, moderation activity, and platform integrity" />

      {metrics.loading && <Spinner />}
      {m && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12, marginBottom: 18 }}>
          <StatCard label="Banned users" value={fmtNum(m.bannedUsers)} tone={m.bannedUsers > 0 ? "warn" : undefined} />
          <StatCard label="Active users" value={fmtNum(m.activeUsers ?? m.totalUsers - m.bannedUsers)} tone="ok" />
          <StatCard label="Total users" value={fmtNum(m.totalUsers)} />
        </div>
      )}

      <div className="card">
        <div className="row spread wrap" style={{ marginBottom: 12, gap: 8 }}>
          <h3 className="panel-title" style={{ margin: 0 }}>Moderation activity</h3>
          <div className="row" style={{ gap: 6 }}>
            {FILTERS.map((f) => (
              <button key={f.key} className={filter === f.key ? "btn tiny" : "btn ghost tiny"} onClick={() => setFilter(f.key)}>{f.label}</button>
            ))}
          </div>
        </div>
        <AuditFeed key={filter} action={active?.action} searchable={false} />
      </div>

      <div className="card" style={{ marginTop: 16, maxWidth: 720 }}>
        <h3 className="panel-title">Coming next</h3>
        <ul style={{ margin: 0, paddingLeft: 18, color: "var(--text-2)", fontSize: 13.5, lineHeight: 1.9 }}>
          <li>User-submitted report queue with triage</li>
          <li>Real ban enforcement: propagate to Cognito + block app access</li>
          <li>Automated content flagging and watchlists</li>
        </ul>
      </div>
    </div>
  );
}
