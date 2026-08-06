import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/useAuth";
import { useAsync } from "../lib/useAsync";
import { fmtNum, fmtRelative, initials } from "../lib/format";
import { PageHeader, StatCard, Spinner, ErrorNote, Badge, EmptyState, InfoNote } from "../components/ui";
import { useToast } from "../components/Toast";
import type { LiveResponse, LiveStream, LiveRoomDetail } from "../types";

type Filter = "all" | "live" | "ended";

function StreamCard({
  s,
  onHost,
  onDetail,
  onForceEnd,
  busy,
  canForceEnd = true,
}: {
  s: LiveStream;
  onHost: () => void;
  onDetail: () => void;
  onForceEnd: () => void;
  busy: boolean;
  canForceEnd?: boolean;
}) {
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
          {isLive ? <Badge kind="err">LIVE</Badge> : <Badge kind="neutral">Ended</Badge>}
        </div>
        {isLive && (
          <div style={{ position: "absolute", top: 8, right: 8, background: "rgba(0,0,0,0.6)", borderRadius: 8, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>
            {fmtNum(s.viewerCount)} watching
          </div>
        )}
      </div>
      <div style={{ fontWeight: 700, fontSize: 14, marginTop: 10, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.title || "Untitled stream"}</div>
      <div className="row" style={{ gap: 8, marginTop: 8, cursor: "pointer" }} onClick={onHost}>
        <span style={{ width: 24, height: 24, borderRadius: 7, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, rgba(0,210,190,0.25), rgba(103,232,249,0.18))", color: "var(--brand-light)", fontSize: 10, fontWeight: 800 }}>
          {initials(s.hostDisplayName || s.hostUsername, s.userId)}
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.hostDisplayName || s.hostUsername || s.userId.slice(0, 12)}</div>
          <div className="dim" style={{ fontSize: 10 }}>{isLive ? `started ${fmtRelative(s.createdAt)}` : fmtRelative(s.createdAt)}</div>
        </div>
      </div>
      <div className="row" style={{ gap: 14, marginTop: 10, fontSize: 11, color: "var(--text-2)" }}>
        <span>{fmtNum(s.totalViews)} views</span>
        <span>{fmtNum(s.likes)} likes</span>
        <span>{fmtNum(s.peakViewerCount)} peak</span>
      </div>
      <div className="row spread" style={{ marginTop: 12, gap: 6, flexWrap: "wrap" }}>
        <button className="btn ghost tiny" onClick={onDetail}>Room detail</button>
        <button className="btn ghost tiny" onClick={onHost}>Host 360</button>
        {isLive && (
          <button className="btn danger tiny" disabled={busy || !canForceEnd} title={!canForceEnd ? "Missing permission" : undefined} onClick={onForceEnd}>
            {busy ? "…" : "Force end"}
          </button>
        )}
      </div>
      <div className="dim mono" style={{ fontSize: 10, marginTop: 8 }}>{s.streamId}</div>
    </div>
  );
}

function RoomDetailPanel({
  sessionId,
  onClose,
  onForceEnd,
  canForceEnd = true,
}: {
  sessionId: string;
  onClose: () => void;
  onForceEnd: () => void;
  canForceEnd?: boolean;
}) {
  const navigate = useNavigate();
  const res = useAsync<LiveRoomDetail>(
    () => api.get<LiveRoomDetail>(`/admin/live/${encodeURIComponent(sessionId)}`),
    [sessionId],
  );
  const d = res.data;
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="row spread" style={{ marginBottom: 10 }}>
        <h3 className="panel-title" style={{ margin: 0 }}>Room detail</h3>
        <button className="btn ghost tiny" onClick={onClose}>Close</button>
      </div>
      {res.loading && <Spinner />}
      {res.error && <ErrorNote>{res.error}</ErrorNote>}
      {d && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10, marginBottom: 12 }}>
            <div><div className="dim" style={{ fontSize: 11 }}>Status</div><div style={{ fontWeight: 700 }}>{d.status || "—"}</div></div>
            <div><div className="dim" style={{ fontSize: 11 }}>Viewers</div><div style={{ fontWeight: 700 }}>{d.viewerCount != null ? fmtNum(d.viewerCount) : "—"}</div></div>
            <div><div className="dim" style={{ fontSize: 11 }}>Peak</div><div style={{ fontWeight: 700 }}>{d.peakViewerCount != null ? fmtNum(d.peakViewerCount) : "—"}</div></div>
            <div><div className="dim" style={{ fontSize: 11 }}>Started</div><div style={{ fontWeight: 700 }}>{d.startedAt ? fmtRelative(d.startedAt) : "—"}</div></div>
            <div><div className="dim" style={{ fontSize: 11 }}>Heartbeat</div><div style={{ fontWeight: 700 }}>{d.lastHeartbeatAt ? fmtRelative(d.lastHeartbeatAt) : "—"}</div></div>
            <div><div className="dim" style={{ fontSize: 11 }}>Dynamo</div><div style={{ fontWeight: 700 }}>{d.dynamo?.status || "missing"}</div></div>
          </div>
          <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>{d.title || "Untitled"}</div>
          {d.hostUserId && (
            <button className="btn ghost tiny" onClick={() => navigate(`/people/${encodeURIComponent(d.hostUserId!)}`)}>
              Host {d.hostUserId.slice(0, 12)}…
            </button>
          )}
          {d.dynamo?.moderators?.length ? (
            <InfoNote>Moderators: {d.dynamo.moderators.join(", ")}</InfoNote>
          ) : null}
          {!d.firestore && <InfoNote>Firestore directory row missing — Dynamo-only view.</InfoNote>}
          {!d.dynamo && <InfoNote>Dynamo session missing — Firestore directory only.</InfoNote>}
          {(d.status === "live" || d.dynamo?.status === "LIVE") && (
            <button className="btn danger tiny" style={{ marginTop: 10 }} disabled={!canForceEnd} title={!canForceEnd ? "Missing permission" : undefined} onClick={onForceEnd}>Force end</button>
          )}
        </>
      )}
    </div>
  );
}

export default function Live() {
  const navigate = useNavigate();
  const toast = useToast();
  const { can } = useAuth();
  const canForceEnd = can("live.force_end");
  const [filter, setFilter] = useState<Filter>("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const res = useAsync<LiveResponse>(() => api.get<LiveResponse>(`/admin/live${filter !== "all" ? `?status=${filter}` : ""}`), [filter]);
  const data = res.data;

  async function forceEnd(streamId: string) {
    if (!canForceEnd) {
      toast.push("Missing live.force_end permission", "err");
      return;
    }
    const reason = window.prompt("Force-end reason (audited):", "Trust & Safety / Live ops");
    if (reason === null) return;
    if (!window.confirm(`Force-end stream ${streamId}? This ends the IVS session server-side.`)) return;
    setBusyId(streamId);
    try {
      await api.post(`/admin/live/${encodeURIComponent(streamId)}/force-end`, {
        reason: reason.trim() || undefined,
      });
      toast.push("Stream force-ended", "ok");
      res.reload();
    } catch (e) {
      toast.push(e instanceof ApiError ? e.message : String(e), "err");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Live"
        subtitle="Active and recent live streams · room detail + force-end"
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

      {detailId && (
        <RoomDetailPanel
          sessionId={detailId}
          onClose={() => setDetailId(null)}
          onForceEnd={() => forceEnd(detailId)}
          canForceEnd={canForceEnd}
        />
      )}

      {res.loading && <Spinner label="Loading streams…" />}
      {res.error && <ErrorNote>{res.error}</ErrorNote>}
      {data?.degraded && <ErrorNote>Live data unavailable: {data.detail}</ErrorNote>}

      {data && !res.loading && !data.degraded && (
        data.items.length === 0 ? (
          <EmptyState>No streams found{filter !== "all" ? ` with status "${filter}"` : ""}.</EmptyState>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
            {data.items.map((s) => (
              <StreamCard
                key={s.streamId}
                s={s}
                busy={busyId === s.streamId}
                canForceEnd={canForceEnd}
                onHost={() => navigate(`/people/${encodeURIComponent(s.userId)}`)}
                onDetail={() => setDetailId(s.streamId)}
                onForceEnd={() => forceEnd(s.streamId)}
              />
            ))}
          </div>
        )
      )}
    </div>
  );
}
