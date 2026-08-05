import { useCallback, useState } from "react";
import { api, ApiError } from "../api/client";
import { useAsync } from "../lib/useAsync";
import { fmtDate, fmtNum } from "../lib/format";
import { PageHeader, StatCard, Spinner, ErrorNote, Badge } from "../components/ui";
import AuditFeed from "../components/AuditFeed";
import type { MetricsOverview } from "../types";

const FILTERS: { key: string; label: string; action?: string }[] = [
  { key: "all", label: "All activity" },
  { key: "user_ban", label: "Bans", action: "user_ban" },
  { key: "user_capabilities_set", label: "Restrictions", action: "user_capabilities_set" },
  { key: "post_remove", label: "Post removals", action: "post_remove" },
  { key: "report_resolve", label: "Report resolves", action: "report_resolve" },
];

type AdminReport = {
  reportId: string;
  targetType: string;
  targetId: string;
  reporterId: string;
  reasonCode: string;
  details: string;
  status: string;
  surface?: string | null;
  createdAt: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolveNote: string | null;
};

type ReportsResponse = {
  ok: boolean;
  available: boolean;
  reports: AdminReport[];
  detail?: string | null;
};

export default function Safety() {
  const metrics = useAsync<MetricsOverview>(() => api.get<MetricsOverview>("/admin/metrics/overview"), []);
  const [filter, setFilter] = useState("all");
  const [reportStatus, setReportStatus] = useState<"open" | "resolved" | "dismissed" | "all">("open");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reportErr, setReportErr] = useState<string | null>(null);
  const [reportMsg, setReportMsg] = useState<string | null>(null);

  const loadReports = useCallback(
    () => api.get<ReportsResponse>(`/admin/reports?status=${encodeURIComponent(reportStatus)}&limit=50`),
    [reportStatus]
  );
  const reports = useAsync<ReportsResponse>(loadReports, [reportStatus]);

  const m = metrics.data;
  const active = FILTERS.find((f) => f.key === filter);

  async function resolve(reportId: string, status: "resolved" | "dismissed") {
    setBusyId(reportId);
    setReportErr(null);
    setReportMsg(null);
    try {
      await api.post(`/admin/reports/${encodeURIComponent(reportId)}/resolve`, { status });
      setReportMsg(`Report ${reportId} marked ${status}.`);
      reports.reload();
    } catch (e) {
      setReportErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <PageHeader title="Trust & Safety" subtitle="Enforcement, report triage, and platform integrity" />

      {metrics.loading && <Spinner />}
      {m && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12, marginBottom: 18 }}>
          <StatCard label="Banned users" value={fmtNum(m.bannedUsers)} tone={m.bannedUsers > 0 ? "warn" : undefined} />
          <StatCard label="Active users" value={fmtNum(m.activeUsers ?? m.totalUsers - m.bannedUsers)} tone="ok" />
          <StatCard label="Total users" value={fmtNum(m.totalUsers)} />
          <StatCard
            label={`${reportStatus === "all" ? "Listed" : reportStatus} reports`}
            value={reports.data?.available ? fmtNum(reports.data.reports.length) : "—"}
            tone={reportStatus === "open" && (reports.data?.reports?.length || 0) > 0 ? "warn" : undefined}
          />
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row spread wrap" style={{ marginBottom: 12, gap: 8 }}>
          <h3 className="panel-title" style={{ margin: 0 }}>Report queue</h3>
          <div className="row" style={{ gap: 6 }}>
            {(["open", "resolved", "dismissed", "all"] as const).map((s) => (
              <button
                key={s}
                className={reportStatus === s ? "btn tiny" : "btn ghost tiny"}
                onClick={() => setReportStatus(s)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <p className="muted" style={{ marginTop: -4, fontSize: 12 }}>
          User-submitted reports from the mobile app (`reports` Firestore collection). Resolve or dismiss without deleting history.
        </p>
        {reportMsg && <div style={{ color: "var(--success)", fontSize: 13, marginBottom: 8 }}>{reportMsg}</div>}
        {reportErr && <ErrorNote>{reportErr}</ErrorNote>}
        {reports.loading && <Spinner />}
        {reports.error && <ErrorNote>{reports.error}</ErrorNote>}
        {reports.data && !reports.data.available && (
          <ErrorNote>{reports.data.detail || "Firestore unavailable — cannot load reports."}</ErrorNote>
        )}
        {reports.data?.available && reports.data.reports.length === 0 && (
          <div className="muted" style={{ fontSize: 13 }}>No {reportStatus === "all" ? "" : reportStatus + " "}reports.</div>
        )}
        {reports.data?.available && reports.data.reports.length > 0 && (
          <div className="table-wrap">
            <table style={{ width: "100%", fontSize: 13 }}>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Status</th>
                  <th>Target</th>
                  <th>Reason</th>
                  <th>Reporter</th>
                  <th>Details</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {reports.data.reports.map((r) => (
                  <tr key={r.reportId}>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtDate(r.createdAt)}</td>
                    <td>
                      <Badge kind={r.status === "open" ? "warn" : r.status === "resolved" ? "ok" : "info"}>
                        {r.status}
                      </Badge>
                    </td>
                    <td>
                      <div>{r.targetType || "—"}{r.surface ? ` · ${r.surface}` : ""}</div>
                      <div className="muted" style={{ fontSize: 11, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {r.targetId}
                      </div>
                    </td>
                    <td>{r.reasonCode || "—"}</td>
                    <td className="muted" style={{ fontSize: 11, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {r.reporterId}
                    </td>
                    <td style={{ maxWidth: 220 }}>{r.details || "—"}</td>
                    <td>
                      {r.status === "open" ? (
                        <div className="row" style={{ gap: 6 }}>
                          <button
                            className="btn tiny"
                            disabled={busyId === r.reportId}
                            onClick={() => resolve(r.reportId, "resolved")}
                          >
                            Resolve
                          </button>
                          <button
                            className="btn ghost tiny"
                            disabled={busyId === r.reportId}
                            onClick={() => resolve(r.reportId, "dismissed")}
                          >
                            Dismiss
                          </button>
                        </div>
                      ) : (
                        <span className="muted" style={{ fontSize: 11 }}>
                          {r.resolvedBy ? `by ${r.resolvedBy.slice(0, 8)}…` : "—"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

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
        <h3 className="panel-title">Still deferred</h3>
        <ul style={{ margin: 0, paddingLeft: 18, color: "var(--text-2)", fontSize: 13.5, lineHeight: 1.9 }}>
          <li>Real ban enforcement: propagate to Cognito + block app access</li>
          <li>Automated content flagging and watchlists</li>
        </ul>
      </div>
    </div>
  );
}
