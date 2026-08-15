import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/useAuth";
import { useAsync } from "../lib/useAsync";
import { fmtNum, fmtRelative } from "../lib/format";
import { PageHeader, StatCard, Spinner, ErrorNote, EmptyState, InfoNote, WarnNote } from "../components/ui";
import { useToast } from "../components/Toast";
import type { AnalyticsResponse, PromoteResponse } from "../types";

type AmbassadorTeam = { teamId: string; name: string; memberCount: number };
type AmbassadorsResponse = {
  note?: string;
  teams?: { total?: number; items?: AmbassadorTeam[] };
  roomAmbassadors?: { available?: boolean };
  clubs?: { available?: boolean };
};

type DisputeItem = {
  disputeId: string;
  surface: string;
  referenceId: string;
  summary: string;
  status: string;
};
type DisputesResponse = {
  detail?: string;
  note?: string;
  marbleRaceEnabled?: boolean | null;
  total?: number;
  items?: DisputeItem[];
  statuses?: string[];
};

/** Lightweight SVG area chart — avoids recharts/lodash CJS interop crash under Vite 8. */
function Chart({ data, color, label }: { data: Array<{ date: string; count: number }>; color: string; label: string }) {
  const gradId = `g-${label.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const { path, area, ticks, max } = useMemo(() => {
    const w = 320;
    const h = 160;
    const padX = 8;
    const padY = 12;
    const values = data.length ? data : [{ date: "", count: 0 }];
    const maxVal = Math.max(1, ...values.map((d) => d.count));
    const n = Math.max(1, values.length - 1);
    const pts = values.map((d, i) => {
      const x = padX + (i / n) * (w - padX * 2);
      const y = h - padY - (d.count / maxVal) * (h - padY * 2);
      return { x, y, ...d };
    });
    const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    const areaPath = pts.length
      ? `${line} L${pts[pts.length - 1].x.toFixed(1)},${(h - padY).toFixed(1)} L${pts[0].x.toFixed(1)},${(h - padY).toFixed(1)} Z`
      : "";
    const tickIdx = [0, Math.floor(values.length / 2), values.length - 1].filter((i, idx, arr) => i >= 0 && arr.indexOf(i) === idx);
    return {
      path: line,
      area: areaPath,
      max: maxVal,
      ticks: tickIdx.map((i) => ({
        label: (values[i]?.date || "").slice(5),
        x: pts[i]?.x ?? 0,
      })),
    };
  }, [data]);

  return (
    <div className="card">
      <h3 className="panel-title">{label}</h3>
      <div style={{ width: "100%", height: 220 }}>
        {data.length === 0 ? (
          <EmptyState>No data in this window.</EmptyState>
        ) : (
          <svg viewBox="0 0 320 180" width="100%" height="200" role="img" aria-label={label}>
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.5} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            {[0.25, 0.5, 0.75].map((f) => (
              <line
                key={f}
                x1="8"
                x2="312"
                y1={12 + (1 - f) * 136}
                y2={12 + (1 - f) * 136}
                stroke="rgba(255,255,255,0.06)"
              />
            ))}
            <path d={area} fill={`url(#${gradId})`} />
            <path d={path} fill="none" stroke={color} strokeWidth="2" />
            {ticks.map((t) => (
              <text key={`${t.label}-${t.x}`} x={t.x} y={176} textAnchor="middle" fill="#71717A" fontSize="10">
                {t.label}
              </text>
            ))}
            <text x="8" y="14" fill="#71717A" fontSize="10">
              max {fmtNum(max)}
            </text>
          </svg>
        )}
      </div>
    </div>
  );
}

export default function Growth() {
  const navigate = useNavigate();
  const toast = useToast();
  const { can } = useAuth();
  const canRank = can("growth.rankings");
  const canFeed = can("growth.feed_priority");
  const res = useAsync<AnalyticsResponse>(() => api.get<AnalyticsResponse>("/admin/analytics"), []);
  const promote = useAsync<PromoteResponse>(() => api.get<PromoteResponse>("/admin/promote?status=all&limit=40"), []);
  const ambassadors = useAsync<AmbassadorsResponse>(() => api.get("/admin/growth/ambassadors"), []);
  const disputes = useAsync<DisputesResponse>(() => api.get("/admin/games/disputes"), []);
  const canDispute = can("reports.resolve");
  const [rankBusy, setRankBusy] = useState(false);
  const [rankNote, setRankNote] = useState<string | null>(null);
  const [bulkSubs, setBulkSubs] = useState("");
  const [bulkPriority, setBulkPriority] = useState("high");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [disputeRef, setDisputeRef] = useState("");
  const [disputeSummary, setDisputeSummary] = useState("");
  const [disputeSurface, setDisputeSurface] = useState("battle");
  const [disputeBusy, setDisputeBusy] = useState(false);
  const d = res.data;

  async function materializeRankings() {
    if (!canRank) {
      toast.push("Missing growth.rankings", "err");
      return;
    }
    if (!window.confirm("Materialize rankings snapshots now? Same work as the nightly cron. Audited.")) return;
    setRankBusy(true);
    setRankNote(null);
    try {
      const out = await api.post<{ ok: boolean; durationMs?: number; results?: unknown }>("/admin/rankings/materialize", {});
      const msg = `Rankings materialize ${out.ok ? "ok" : "partial"} · ${out.durationMs ?? "?"}ms`;
      setRankNote(msg);
      toast.push(msg, out.ok ? "ok" : "info");
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : String(e);
      setRankNote(msg);
      toast.push(msg, "err");
    } finally {
      setRankBusy(false);
    }
  }

  async function bulkFeed() {
    if (!canFeed) {
      toast.push("Missing growth.feed_priority", "err");
      return;
    }
    const userIds = bulkSubs.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    if (!userIds.length) return;
    if (!window.confirm(`Set feed priority “${bulkPriority}” for ${userIds.length} account(s)?`)) return;
    setBulkBusy(true);
    try {
      const out = await api.post<{ results: Array<{ userId: string; ok: boolean }> }>("/admin/feed-priority/bulk", {
        userIds,
        priority: bulkPriority,
        reason: "growth console bulk",
      });
      const ok = out.results.filter((r) => r.ok).length;
      toast.push(`Feed priority updated for ${ok}/${out.results.length}`, "ok");
    } catch (e) {
      toast.push(e instanceof ApiError ? e.message : String(e), "err");
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Growth & Analytics"
        subtitle="Acquisition, content velocity, What's Hot bulk, ambassadors stub"
        actions={
          <div className="row" style={{ gap: 8 }}>
            <button className="btn ghost tiny" disabled={rankBusy || !canRank} title={!canRank ? "Missing permission" : undefined} onClick={materializeRankings}>
              {rankBusy ? "Materializing…" : "Materialize rankings"}
            </button>
            <button className="btn ghost tiny" onClick={() => res.reload()}>Refresh</button>
          </div>
        }
      />

      {res.loading && <Spinner label="Crunching analytics…" />}
      {res.error && <ErrorNote>{res.error}</ErrorNote>}
      {rankNote && <div style={{ marginBottom: 12 }}><InfoNote>{rankNote}</InfoNote></div>}

      {d && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12, marginBottom: 16 }}>
            <StatCard label="Total users" value={fmtNum(d.totals.directoryUsers)} />
            <StatCard label="New · 7d" value={fmtNum(d.totals.signups7d)} tone="ok" />
            <StatCard label="Total posts" value={fmtNum(d.totals.totalPosts)} hint={d.totals.postsCounted ? "exact" : "approx (recent window)"} />
            <StatCard label="Posts · 7d" value={fmtNum(d.totals.posts7d)} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
            <Chart data={d.signupsByDay} color="#00D2BE" label="Signups (30d)" />
            <Chart data={d.postsByDay} color="#67E8F9" label="Posts (30d)" />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 16 }}>
            <div className="card">
              <h3 className="panel-title">Top creators</h3>
              {d.topCreators.length === 0 ? <EmptyState>No posts yet.</EmptyState> : (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Creator</th><th style={{ textAlign: "right" }}>Posts</th></tr></thead>
                    <tbody>
                      {d.topCreators.map((c) => (
                        <tr key={c.userId} className="clickable" onClick={() => navigate(`/people/${encodeURIComponent(c.userId)}`)}>
                          <td>{c.displayName}</td>
                          <td style={{ textAlign: "right", fontWeight: 700 }}>{fmtNum(c.count)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="card">
              <h3 className="panel-title">By country</h3>
              {d.countries.length === 0 ? <EmptyState>No location data.</EmptyState> : (
                <div className="table-wrap" style={{ maxHeight: 320 }}>
                  <table>
                    <thead><tr><th>Country</th><th style={{ textAlign: "right" }}>Users</th></tr></thead>
                    <tbody>
                      {d.countries.map((c) => (
                        <tr key={c.country}><td>{c.country}</td><td style={{ textAlign: "right" }}>{fmtNum(c.count)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <h3 className="panel-title">What's Hot · bulk feed priority</h3>
            <p className="dim" style={{ fontSize: 12.5, marginTop: 0 }}>
              Paste Cognito subs (comma/newline). Writes account-wide <code>feedPriorityAccount</code> (1–50).
            </p>
            <textarea rows={3} value={bulkSubs} onChange={(e) => setBulkSubs(e.target.value)} placeholder="sub-1&#10;sub-2" />
            <div className="row wrap" style={{ gap: 10, marginTop: 8 }}>
              <select value={bulkPriority} onChange={(e) => setBulkPriority(e.target.value)}>
                {["suppress", "low", "standard", "high", "boost"].map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <button className="btn tiny" disabled={bulkBusy || !canFeed || !bulkSubs.trim()} onClick={bulkFeed}>
                {bulkBusy ? "Applying…" : "Apply bulk priority"}
              </button>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
            <div className="card">
              <h3 className="panel-title">Ambassadors / clubs</h3>
              {ambassadors.loading && <Spinner />}
              {ambassadors.error && <ErrorNote>{ambassadors.error}</ErrorNote>}
              {ambassadors.data && (
                <>
                  <InfoNote>{ambassadors.data.note}</InfoNote>
                  <p className="dim" style={{ fontSize: 12 }}>
                    Teams loaded: {ambassadors.data.teams?.total ?? 0}. Room ambassadors: {ambassadors.data.roomAmbassadors?.available ? "yes" : "not wired"}.
                    Clubs: {ambassadors.data.clubs?.available ? "yes" : "not wired"}.
                  </p>
                  {(ambassadors.data.teams?.items || []).slice(0, 8).map((t) => (
                    <div key={t.teamId} className="row spread" style={{ fontSize: 13, padding: "4px 0", borderTop: "1px solid var(--border)" }}>
                      <span>{t.name}</span>
                      <span className="dim">{fmtNum(t.memberCount)} members</span>
                    </div>
                  ))}
                </>
              )}
            </div>
            <div className="card">
              <h3 className="panel-title">Battle / marble disputes</h3>
              {disputes.loading && <Spinner />}
              {disputes.error && <ErrorNote>{disputes.error}</ErrorNote>}
              {disputes.data && (
                <>
                  <WarnNote>
                    Settlement not wired — status workflow only. <code>noted_freeze</code> records intent; do not assume pots are frozen.
                  </WarnNote>
                  <InfoNote>{disputes.data.detail || disputes.data.note}</InfoNote>
                  <p className="dim" style={{ fontSize: 12 }}>
                    Marble race env: {String(disputes.data.marbleRaceEnabled)} · open disputes: {disputes.data.total ?? 0}
                  </p>
                  {canDispute && (
                    <div className="stack" style={{ gap: 8, marginTop: 8 }}>
                      <div className="row wrap" style={{ gap: 8 }}>
                        <select value={disputeSurface} onChange={(e) => setDisputeSurface(e.target.value)}>
                          <option value="battle">battle</option>
                          <option value="marble">marble</option>
                          <option value="live_game">live_game</option>
                          <option value="other">other</option>
                        </select>
                        <input className="grow" value={disputeRef} onChange={(e) => setDisputeRef(e.target.value)} placeholder="session / match / room id" />
                      </div>
                      <input value={disputeSummary} onChange={(e) => setDisputeSummary(e.target.value)} placeholder="Short summary" />
                      <button
                        className="btn tiny"
                        disabled={disputeBusy || !disputeRef.trim() || !disputeSummary.trim()}
                        onClick={async () => {
                          setDisputeBusy(true);
                          try {
                            await api.post("/admin/games/disputes", {
                              surface: disputeSurface,
                              referenceId: disputeRef.trim(),
                              summary: disputeSummary.trim(),
                            });
                            toast.push("Dispute opened", "ok");
                            setDisputeRef("");
                            setDisputeSummary("");
                            disputes.reload();
                          } catch (e) {
                            toast.push(e instanceof ApiError ? e.message : String(e), "err");
                          } finally {
                            setDisputeBusy(false);
                          }
                        }}
                      >
                        Open dispute
                      </button>
                    </div>
                  )}
                  {(disputes.data.items || []).slice(0, 12).map((item) => (
                    <div key={item.disputeId} className="row spread" style={{ fontSize: 12, padding: "6px 0", borderTop: "1px solid var(--border)" }}>
                      <div>
                        <strong>{item.surface}</strong> · {item.referenceId}
                        <div className="dim">{item.summary}</div>
                      </div>
                      <div className="row" style={{ gap: 4 }}>
                        <span className="dim">{item.status}</span>
                        {canDispute && (
                          <select
                            value={item.status}
                            disabled={disputeBusy}
                            onChange={async (e) => {
                              setDisputeBusy(true);
                              try {
                                await api.post(`/admin/games/disputes/${encodeURIComponent(item.disputeId)}/status`, {
                                  status: e.target.value,
                                });
                                toast.push("Dispute status updated", "ok");
                                disputes.reload();
                              } catch (err) {
                                toast.push(err instanceof ApiError ? err.message : String(err), "err");
                              } finally {
                                setDisputeBusy(false);
                              }
                            }}
                          >
                            {(disputes.data?.statuses || ["open", "investigating", "noted_freeze", "resolved", "closed"]).map((s: string) => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="row spread" style={{ marginBottom: 8 }}>
              <h3 className="panel-title" style={{ margin: 0 }}>Promote queue</h3>
              <button className="btn ghost tiny" onClick={() => promote.reload()}>Refresh</button>
            </div>
            <InfoNote>Read-only view of Postgres <code>promotions</code> (battle / slot / spotlight bookings).</InfoNote>
            {promote.loading && <Spinner />}
            {promote.error && <ErrorNote>{promote.error}</ErrorNote>}
            {promote.data?.degraded && <ErrorNote>{promote.data.detail}</ErrorNote>}
            {promote.data && promote.data.items.length === 0 && <EmptyState>No promotions rows.</EmptyState>}
            {promote.data && promote.data.items.length > 0 && (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>When</th><th>User</th><th>Type</th><th>Status</th><th>Coins</th><th>Window</th></tr></thead>
                  <tbody>
                    {promote.data.items.map((p) => (
                      <tr key={p.promotionId} className="clickable" onClick={() => navigate(`/people/${encodeURIComponent(p.userId)}`)}>
                        <td className="muted" style={{ fontSize: 12 }}>{fmtRelative(p.createdAt)}</td>
                        <td className="mono" style={{ fontSize: 11 }}>{p.userId.slice(0, 12)}…</td>
                        <td>{p.promotionType}</td>
                        <td>{p.status}</td>
                        <td>{fmtNum(p.coinCost)}</td>
                        <td className="dim" style={{ fontSize: 11 }}>
                          {p.startsAt ? fmtRelative(p.startsAt) : "—"} → {p.endsAt ? fmtRelative(p.endsAt) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
