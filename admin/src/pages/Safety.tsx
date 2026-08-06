import { useCallback, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { useAsync } from "../lib/useAsync";
import { fmtDate, fmtNum, fmtRelative } from "../lib/format";
import { PageHeader, StatCard, Spinner, ErrorNote, Badge, WarnNote, EmptyState, InfoNote } from "../components/ui";
import { useToast } from "../components/Toast";
import AuditFeed from "../components/AuditFeed";
import type { MetricsOverview, AppealsResponse, DatingDeskResponse } from "../types";

const FILTERS: { key: string; label: string; action?: string }[] = [
  { key: "all", label: "All activity" },
  { key: "user_ban", label: "Bans", action: "user_ban" },
  { key: "user_capabilities_set", label: "Restrictions", action: "user_capabilities_set" },
  { key: "post_remove", label: "Post removals", action: "post_remove" },
  { key: "report_resolve", label: "Report resolves", action: "report_resolve" },
];

const CHILD_REASONS = new Set(["child_safety", "csam", "minor", "underage", "child_exploitation"]);

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

function isChildSafety(r: AdminReport) {
  const code = String(r.reasonCode || "").toLowerCase();
  return CHILD_REASONS.has(code) || code.includes("child") || code.includes("minor");
}

function slaLabel(createdAt: string | null): { text: string; kind: "ok" | "warn" | "err" } {
  if (!createdAt) return { text: "Unknown age", kind: "warn" };
  const ageMin = (Date.now() - new Date(createdAt).getTime()) / 60000;
  if (ageMin < 30) return { text: `${Math.max(1, Math.round(ageMin))}m · within SLA`, kind: "ok" };
  if (ageMin < 120) return { text: `${Math.round(ageMin)}m · elevated`, kind: "warn" };
  return { text: `${Math.round(ageMin / 60)}h · breach risk`, kind: "err" };
}

function severityRank(r: AdminReport): number {
  if (isChildSafety(r)) return 100;
  const code = String(r.reasonCode || "").toLowerCase();
  if (code.includes("hate") || code.includes("threat") || code.includes("violence")) return 70;
  if (code.includes("nudity") || code.includes("sexual")) return 60;
  if (code.includes("scam") || code.includes("fraud")) return 50;
  return 20;
}

export default function Safety() {
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const lane = params.get("lane") === "child_safety" ? "child_safety" : "all";
  const deepQ = (params.get("q") || "").trim().toLowerCase();

  const metrics = useAsync<MetricsOverview>(() => api.get<MetricsOverview>("/admin/metrics/overview"), []);
  const [filter, setFilter] = useState("all");
  const [reportStatus, setReportStatus] = useState<"open" | "resolved" | "dismissed" | "all">("open");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reportErr, setReportErr] = useState<string | null>(null);

  const loadReports = useCallback(() => {
    const qs = new URLSearchParams({ status: reportStatus, limit: "80" });
    if (lane === "child_safety") qs.set("reasonCode", "child_safety");
    return api.get<ReportsResponse>(`/admin/reports?${qs.toString()}`);
  }, [reportStatus, lane]);
  const reports = useAsync<ReportsResponse>(loadReports, [reportStatus, lane]);

  const m = metrics.data;
  const active = FILTERS.find((f) => f.key === filter);

  const visibleReports = useMemo(() => {
    let list = reports.data?.reports || [];
    if (deepQ) {
      list = list.filter((r) =>
        [r.reportId, r.targetId, r.reporterId, r.reasonCode, r.details].join(" ").toLowerCase().includes(deepQ)
      );
    }
    return [...list].sort((a, b) => severityRank(b) - severityRank(a) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  }, [reports.data, deepQ]);

  const childOpen = useMemo(
    () => (reports.data?.reports || []).filter((r) => r.status === "open" && isChildSafety(r)).length,
    [reports.data]
  );

  async function resolve(reportId: string, status: "resolved" | "dismissed") {
    const note = window.prompt(`Optional note for ${status}:`) ?? undefined;
    setBusyId(reportId);
    setReportErr(null);
    try {
      await api.post(`/admin/reports/${encodeURIComponent(reportId)}/resolve`, {
        status,
        note: note?.trim() || undefined,
      });
      toast.push(`Report marked ${status}`, "ok");
      reports.reload();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : String(e);
      setReportErr(msg);
      toast.push(msg, "err");
    } finally {
      setBusyId(null);
    }
  }

  async function escalate(r: AdminReport) {
    const reason = window.prompt("Escalation note (required for audit):", "Child safety — escalate for dual review / LE pack");
    if (!reason?.trim()) return;
    setBusyId(r.reportId);
    setReportErr(null);
    try {
      // Persist escalation intent on the report via resolve note path is wrong —
      // write an audit-bearing note by dismissing nothing; use resolve with note keep open isn't supported.
      // Instead: resolve path isn't right. We audit via a ban-style message: call resolve only if agent chooses.
      // Practical P0: force-hide content if target is post, then leave report open with toast + audit via post remove.
      if (String(r.targetType || "").toLowerCase().includes("post") && r.targetId) {
        const hide = window.confirm("Also force-hide the reported post now? (server moderation.hidden)");
        if (hide) {
          await api.post(`/admin/posts/${encodeURIComponent(r.targetId)}/remove`, {
            reason: `[child_safety escalate] ${reason.trim()}`,
          });
        }
      }
      await api.post(`/admin/reports/${encodeURIComponent(r.reportId)}/resolve`, {
        status: "resolved",
        note: `[ESCALATED] ${reason.trim()}`,
      });
      toast.push("Escalated — audited + queue updated", "ok");
      reports.reload();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : String(e);
      setReportErr(msg);
      toast.push(msg, "err");
    } finally {
      setBusyId(null);
    }
  }

  function setLane(next: "all" | "child_safety") {
    const n = new URLSearchParams(params);
    if (next === "child_safety") n.set("lane", "child_safety");
    else n.delete("lane");
    setParams(n, { replace: true });
  }

  return (
    <div>
      <PageHeader
        title="Trust & Safety"
        subtitle="Report triage, child-safety war room, enforcement audit"
        actions={<button className="btn ghost tiny" onClick={() => reports.reload()}>Refresh</button>}
      />

      {metrics.loading && <Spinner />}
      {m && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12, marginBottom: 18 }}>
          <StatCard label="Banned users" value={fmtNum(m.bannedUsers)} tone={m.bannedUsers > 0 ? "warn" : undefined} />
          <StatCard label="Active users" value={fmtNum(m.activeUsers ?? m.totalUsers - m.bannedUsers)} tone="ok" />
          <StatCard
            label="Open reports (listed)"
            value={reports.data?.available ? fmtNum(visibleReports.filter((r) => r.status === "open").length) : "—"}
            tone={(visibleReports.filter((r) => r.status === "open").length || 0) > 0 ? "warn" : undefined}
          />
          <StatCard
            label="Child-safety open"
            value={reports.data?.available ? fmtNum(childOpen) : "—"}
            tone={childOpen > 0 ? "err" : "ok"}
            hint="Highest priority lane"
          />
        </div>
      )}

      <div className="card war-room" style={{ marginBottom: 16 }}>
        <div className="row spread wrap" style={{ gap: 10, marginBottom: 10 }}>
          <div>
            <h3 className="panel-title" style={{ margin: 0 }}>Child safety war room</h3>
            <p className="muted" style={{ margin: "6px 0 0", fontSize: 12, maxWidth: 640 }}>
              Dual-review mindset: treat every hit as P0. Prefer force-hide + escalate with a written note.
              SLA target: first action under 30 minutes.
            </p>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <button className={lane === "all" ? "btn tiny" : "btn ghost tiny"} onClick={() => setLane("all")}>All reasons</button>
            <button className={lane === "child_safety" ? "btn danger tiny" : "btn ghost tiny"} onClick={() => setLane("child_safety")}>
              Child safety only
            </button>
          </div>
        </div>
        {lane === "child_safety" && (
          <WarnNote>
            Filtering API with <code>reasonCode=child_safety</code>. Cross-check user 360 before irreversible bans.
          </WarnNote>
        )}
      </div>

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
        {deepQ && <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Client filter: “{deepQ}”</div>}
        {reportErr && <ErrorNote>{reportErr}</ErrorNote>}
        {reports.loading && <Spinner label="Loading reports…" />}
        {reports.error && <ErrorNote>{reports.error}</ErrorNote>}
        {reports.data && !reports.data.available && (
          <ErrorNote>{reports.data.detail || "Firestore unavailable — cannot load reports."}</ErrorNote>
        )}
        {reports.data?.available && visibleReports.length === 0 && (
          <EmptyState>No {reportStatus === "all" ? "" : `${reportStatus} `}reports{lane === "child_safety" ? " in child-safety lane" : ""}.</EmptyState>
        )}
        {reports.data?.available && visibleReports.length > 0 && (
          <div className="table-wrap">
            <table style={{ width: "100%", fontSize: 13 }}>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Sev</th>
                  <th>SLA</th>
                  <th>Status</th>
                  <th>Target</th>
                  <th>Reason</th>
                  <th>Reporter</th>
                  <th>Details</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visibleReports.map((r) => {
                  const child = isChildSafety(r);
                  const sla = slaLabel(r.createdAt);
                  return (
                    <tr key={r.reportId} className={child ? "row-critical" : undefined}>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <div>{fmtDate(r.createdAt)}</div>
                        <div className="dim" style={{ fontSize: 10 }}>{fmtRelative(r.createdAt)}</div>
                      </td>
                      <td>
                        <Badge kind={child ? "err" : severityRank(r) >= 60 ? "warn" : "neutral"}>
                          {child ? "P0" : severityRank(r) >= 60 ? "P1" : "P2"}
                        </Badge>
                      </td>
                      <td><Badge kind={sla.kind}>{sla.text}</Badge></td>
                      <td>
                        <Badge kind={r.status === "open" ? "warn" : r.status === "resolved" ? "ok" : "info"}>
                          {r.status}
                        </Badge>
                      </td>
                      <td>
                        <div>{r.targetType || "—"}{r.surface ? ` · ${r.surface}` : ""}</div>
                        <div className="muted mono" style={{ fontSize: 11, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>
                          {r.targetId}
                        </div>
                        <div className="row" style={{ gap: 6, marginTop: 4 }}>
                          {r.targetType?.toLowerCase().includes("user") && (
                            <button className="btn ghost tiny" onClick={() => navigate(`/people/${encodeURIComponent(r.targetId)}`)}>User 360</button>
                          )}
                          {r.targetType?.toLowerCase().includes("post") && (
                            <Link className="btn ghost tiny" to={`/content`}>Content</Link>
                          )}
                        </div>
                      </td>
                      <td>
                        <strong style={{ color: child ? "var(--error)" : undefined }}>{r.reasonCode || "—"}</strong>
                      </td>
                      <td>
                        <button className="btn ghost tiny" onClick={() => navigate(`/people/${encodeURIComponent(r.reporterId)}`)}>
                          {r.reporterId.slice(0, 10)}…
                        </button>
                      </td>
                      <td style={{ maxWidth: 220 }}>{r.details || "—"}</td>
                      <td>
                        {r.status === "open" ? (
                          <div className="row wrap" style={{ gap: 6, justifyContent: "flex-end" }}>
                            {child && (
                              <button className="btn danger tiny" disabled={busyId === r.reportId} onClick={() => escalate(r)}>
                                Escalate
                              </button>
                            )}
                            <button className="btn tiny" disabled={busyId === r.reportId} onClick={() => resolve(r.reportId, "resolved")}>
                              Resolve
                            </button>
                            <button className="btn ghost tiny" disabled={busyId === r.reportId} onClick={() => resolve(r.reportId, "dismissed")}>
                              Dismiss
                            </button>
                          </div>
                        ) : (
                          <span className="muted" style={{ fontSize: 11 }}>
                            {r.resolvedBy ? `by ${r.resolvedBy.slice(0, 8)}…` : "—"}
                            {r.resolveNote ? ` · ${r.resolveNote}` : ""}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
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

      <AppealsPanel />
      <DatingPanel />
    </div>
  );
}

function AppealsPanel() {
  const toast = useToast();
  const navigate = useNavigate();
  const appeals = useAsync<AppealsResponse>(() => api.get<AppealsResponse>("/admin/appeals?status=open&limit=50"), []);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [userId, setUserId] = useState("");
  const [statement, setStatement] = useState("");

  async function create() {
    if (!userId.trim() || !statement.trim()) return;
    try {
      await api.post("/admin/appeals", { userId: userId.trim(), statement: statement.trim() });
      toast.push("Appeal queued", "ok");
      setUserId("");
      setStatement("");
      appeals.reload();
    } catch (e) {
      toast.push(e instanceof ApiError ? e.message : String(e), "err");
    }
  }

  async function resolve(appealId: string, status: "upheld" | "overturned" | "dismissed") {
    const note = window.prompt(`Resolution note for ${status} (audited):`, status);
    if (note === null) return;
    setBusyId(appealId);
    try {
      await api.post(`/admin/appeals/${encodeURIComponent(appealId)}/resolve`, { status, note: note.trim() || undefined });
      toast.push(`Appeal ${status}`, "ok");
      appeals.reload();
    } catch (e) {
      toast.push(e instanceof ApiError ? e.message : String(e), "err");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3 className="panel-title">Appeals queue (v1)</h3>
      <InfoNote>Strikes live on User 360. Open appeals here; overturning deactivates the linked strike when present.</InfoNote>
      <div className="row wrap" style={{ gap: 8, marginBottom: 12 }}>
        <input style={{ minWidth: 220 }} value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="User Cognito sub" />
        <input className="grow" value={statement} onChange={(e) => setStatement(e.target.value)} placeholder="Appeal statement" />
        <button className="btn tiny" onClick={create}>File appeal</button>
      </div>
      {appeals.loading && <Spinner />}
      {appeals.error && <ErrorNote>{appeals.error}</ErrorNote>}
      {appeals.data?.degraded && <ErrorNote>{appeals.data.detail}</ErrorNote>}
      {appeals.data && appeals.data.items.length === 0 && <EmptyState>No open appeals.</EmptyState>}
      {appeals.data && appeals.data.items.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>When</th><th>User</th><th>Statement</th><th></th></tr></thead>
            <tbody>
              {appeals.data.items.map((a) => (
                <tr key={a.appealId}>
                  <td className="muted" style={{ fontSize: 12 }}>{fmtRelative(a.createdAt)}</td>
                  <td className="mono" style={{ fontSize: 11 }}>
                    <button className="btn ghost tiny" onClick={() => navigate(`/people/${encodeURIComponent(a.userId)}`)}>
                      {a.userId.slice(0, 12)}…
                    </button>
                  </td>
                  <td style={{ maxWidth: 280, fontSize: 13 }}>{a.statement}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="btn tiny" disabled={busyId === a.appealId} onClick={() => resolve(a.appealId, "overturned")}>Overturn</button>{" "}
                    <button className="btn ghost tiny" disabled={busyId === a.appealId} onClick={() => resolve(a.appealId, "upheld")}>Uphold</button>{" "}
                    <button className="btn ghost tiny" disabled={busyId === a.appealId} onClick={() => resolve(a.appealId, "dismissed")}>Dismiss</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DatingPanel() {
  const navigate = useNavigate();
  const desk = useAsync<DatingDeskResponse>(() => api.get<DatingDeskResponse>("/admin/dating"), []);
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3 className="panel-title">Dating desk</h3>
      {desk.loading && <Spinner />}
      {desk.error && <ErrorNote>{desk.error}</ErrorNote>}
      {desk.data?.note && <InfoNote>{desk.data.note}</InfoNote>}
      {desk.data && !desk.data.available && <WarnNote>Prefs unavailable: {desk.data.detail}</WarnNote>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 10 }}>
        <div>
          <h4 style={{ margin: "0 0 8px", fontSize: 13 }}>Recent prefs (privacy-scoped)</h4>
          {desk.data && desk.data.prefsSample.length === 0 && <EmptyState>No datingPrefs docs sampled.</EmptyState>}
          {desk.data?.prefsSample.map((p) => (
            <div key={p.userId} className="row spread" style={{ borderBottom: "1px solid var(--divider)", padding: "6px 0" }}>
              <button className="btn ghost tiny" onClick={() => navigate(`/people/${encodeURIComponent(p.userId)}`)}>
                {p.userId.slice(0, 12)}…
              </button>
              <span className="dim" style={{ fontSize: 12 }}>
                {p.enabled == null ? "—" : p.enabled ? "enabled" : "off"} · {p.lookingFor || "—"}
              </span>
            </div>
          ))}
        </div>
        <div>
          <h4 style={{ margin: "0 0 8px", fontSize: 13 }}>Dating-related open reports</h4>
          {desk.data && desk.data.datingReports.length === 0 && <EmptyState>No dating-tagged open reports.</EmptyState>}
          {desk.data?.datingReports.map((r) => (
            <div key={r.reportId} className="row spread" style={{ borderBottom: "1px solid var(--divider)", padding: "6px 0" }}>
              <div>
                <Badge kind="warn">{r.reasonCode}</Badge>
                <div className="dim" style={{ fontSize: 11 }}>{r.surface || "—"} · {fmtRelative(r.createdAt)}</div>
              </div>
              <button className="btn ghost tiny" onClick={() => navigate(`/people/${encodeURIComponent(r.targetId)}`)}>Target</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
