import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAsync } from "../lib/useAsync";
import { fmtNum, fmtRelative, initials } from "../lib/format";
import { PageHeader, StatCard, Spinner, ErrorNote, Badge, EmptyState } from "../components/ui";
import type { LiveResponse, LiveStream } from "../types";

type Filter = "all" | "live" | "ended";

function StreamCard({ s, onOpen }: { s: LiveStream; onOpen: () => void }) {
  const isLive = s.status === "live";
  return (
    <div className="card" style={{ padding: 12 }}>
      <div style={{ position: "relative", width: "100%", aspectRatio: "16 / 10", borderRadius: 10, overflow: "hidden", background: "var(--surface-2)" }}>
        {s.thumbnailUrl ? (
          <img src={s.thumbnailUrl} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
        ) : (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 12 }}>No preview</div>
        )}
        <div style={{ position: "absolute", top: 8, left: 8 }}>
          {isLive ? <Badge kind="err">● LIVE</Badge> : <Badge kind="neutral">Ended</Badge>}
        </div>
        {isLive && (
          <div style={{ position: "absolute", top: 8, right: 8, background: "rgba(0,0,0,0.6)", borderRadius: 8, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>
            👁 {fmtNum(s.viewerCount)}
          </div>
        )}
      </div>
      <div style={{ fontWeight: 700, fontSize: 14, marginTop: 10, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.title || "Untitled stream"}</div>
      <div className="row" style={{ gap: 8, marginTop: 8, cursor: "pointer" }} onClick={onOpen}>
        <span style={{ width: 24, height: 24, borderRadius: 7, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, rgba(0,210,190,0.25), rgba(103,232,249,0.18))", color: "var(--brand-light)", fontSize: 10, fontWeight: 800 }}>
          {initials(s.hostDisplayName || s.hostUsername, s.userId)}
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.hostDisplayName || s.hostUsername || s.userId.slice(0, 12)}</div>
          <div className="dim" style={{ fontSize: 10 }}>{isLive ? `started ${fmtRelative(s.createdAt)}` : fmtRelative(s.createdAt)}</div>
        </div>
      </div>
      <div className="row" style={{ gap: 14, marginTop: 10, fontSize: 11, color: "var(--text-2)" }}>
        <span>👁 {fmtNum(s.totalViews)} views</span>
        <span>♥ {fmtNum(s.likes)}</span>
        <span>⤒ {fmtNum(s.peakViewerCount)} peak</span>
      </div>
    </div>
  );
}

export default function Live() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>("all");
  const res = useAsync<LiveResponse>(() => api.get<LiveResponse>(`/admin/live${filter !== "all" ? `?status=${filter}` : ""}`), [filter]);
  const data = res.data;

  return (
    <div>
      <PageHeader
        title="Live"
        subtitle="Active and recent live streams"
        actions={<button className="btn ghost tiny" onClick={() => res.reload()}>Refresh</button>}
      />

      {data && !data.degraded && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12, marginBottom: 18 }}>
          <StatCard label="Live now" value={fmtNum(data.live)} tone={data.live > 0 ? "ok" : undefined} />
          <StatCard label="Viewers (live)" value={fmtNum(data.totalViewers)} />
          <StatCard label="Streams loaded" value={fmtNum(data.total)} />
        </div>
      )}

      <div className="row" style={{ gap: 6, marginBottom: 14 }}>
        {(["all", "live", "ended"] as Filter[]).map((f) => (
          <button key={f} className={filter === f ? "btn tiny" : "btn ghost tiny"} onClick={() => setFilter(f)} style={{ textTransform: "capitalize" }}>{f}</button>
        ))}
      </div>

      {res.loading && <Spinner label="Loading streams…" />}
      {res.error && <ErrorNote>{res.error}</ErrorNote>}
      {data?.degraded && <ErrorNote>Live data unavailable: {data.detail}</ErrorNote>}

      {data && !res.loading && !data.degraded && (
        data.items.length === 0 ? (
          <EmptyState>No streams found{filter !== "all" ? ` with status "${filter}"` : ""}.</EmptyState>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
            {data.items.map((s) => (
              <StreamCard key={s.streamId} s={s} onOpen={() => navigate(`/people/${encodeURIComponent(s.userId)}`)} />
            ))}
          </div>
        )
      )}
    </div>
  );
}
