import { useNavigate } from "react-router-dom";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { api } from "../api/client";
import { useAsync } from "../lib/useAsync";
import { fmtNum } from "../lib/format";
import { PageHeader, StatCard, Spinner, ErrorNote, EmptyState } from "../components/ui";
import type { AnalyticsResponse } from "../types";

function Chart({ data, color, label }: { data: Array<{ date: string; count: number }>; color: string; label: string }) {
  return (
    <div className="card">
      <h3 className="panel-title">{label}</h3>
      <div style={{ width: "100%", height: 220 }}>
        <ResponsiveContainer>
          <AreaChart data={data} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
            <defs>
              <linearGradient id={`g-${label}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.5} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis dataKey="date" tick={{ fill: "#71717A", fontSize: 10 }} tickFormatter={(d: string) => d.slice(5)} interval="preserveStartEnd" minTickGap={24} />
            <YAxis tick={{ fill: "#71717A", fontSize: 10 }} allowDecimals={false} width={34} />
            <Tooltip
              contentStyle={{ background: "#15151B", border: "1px solid rgba(255,255,255,0.16)", borderRadius: 10, fontSize: 12 }}
              labelStyle={{ color: "#A1A1AA" }}
            />
            <Area type="monotone" dataKey="count" stroke={color} strokeWidth={2} fill={`url(#g-${label})`} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function Growth() {
  const navigate = useNavigate();
  const res = useAsync<AnalyticsResponse>(() => api.get<AnalyticsResponse>("/admin/analytics"), []);
  const d = res.data;

  return (
    <div>
      <PageHeader
        title="Growth & Analytics"
        subtitle="Acquisition, content velocity, and reach"
        actions={<button className="btn ghost tiny" onClick={() => res.reload()}>Refresh</button>}
      />

      {res.loading && <Spinner label="Crunching analytics…" />}
      {res.error && <ErrorNote>{res.error}</ErrorNote>}

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
        </>
      )}
    </div>
  );
}
