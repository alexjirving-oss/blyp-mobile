import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAsync } from "../lib/useAsync";
import { fmtRelative, initials } from "../lib/format";
import { PageHeader, Spinner, ErrorNote, Badge, EmptyState } from "../components/ui";
import { useToast } from "../components/Toast";
import type { GlobalPostsResponse, GlobalPost } from "../types";

const PAGE = 24;
type RemovedFilter = "all" | "live" | "removed";

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

function Thumb({ post }: { post: GlobalPost }) {
  const url = post.thumbnailUrl || post.mediaUrl;
  if (url) {
    return (
      <div style={{ width: "100%", aspectRatio: "1 / 1", borderRadius: 10, overflow: "hidden", background: "var(--surface-2)" }}>
        <img src={url} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }}
          onError={(e) => { (e.currentTarget.style.display = "none"); }} />
      </div>
    );
  }
  return (
    <div style={{ width: "100%", aspectRatio: "1 / 1", borderRadius: 10, background: "linear-gradient(135deg, var(--surface-2), var(--card-2))", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 11 }}>
      {post.postType}
    </div>
  );
}

export default function Content() {
  const navigate = useNavigate();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [removed, setRemoved] = useState<RemovedFilter>("all");
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const q = useDebounced(query, 350);
  const listKey = `${q}\0${removed}`;
  const [activeKey, setActiveKey] = useState(listKey);
  const effectiveOffset = activeKey === listKey ? offset : 0;
  if (activeKey !== listKey) {
    setActiveKey(listKey);
    setOffset(0);
  }

  const res = useAsync<GlobalPostsResponse>(
    () => api.get<GlobalPostsResponse>(`/admin/posts?q=${encodeURIComponent(q)}&removed=${removed}&limit=${PAGE}&offset=${effectiveOffset}`),
    [q, removed, effectiveOffset]
  );
  const data = res.data;
  const total = data?.total ?? 0;

  async function moderate(p: GlobalPost) {
    const removing = !p.isRemoved;
    let reason: string | null = null;
    if (removing) {
      const typed = window.prompt("Removal reason (required, audited):", "Policy violation");
      if (typed === null) return;
      if (!typed.trim()) {
        toast.push("Reason required to remove content", "err");
        return;
      }
      reason = typed.trim();
    } else if (!window.confirm("Restore this post to discovery?")) {
      return;
    }
    setBusy(p.postId);
    try {
      await api.post(`/admin/posts/${encodeURIComponent(p.postId)}/${removing ? "remove" : "restore"}`, {
        userId: p.userId,
        reason,
      });
      toast.push(removing ? "Post removed (server hide)" : "Post restored", "ok");
      res.reload();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : String(e), "err");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Content & Media"
        subtitle={data?.sourceTable ? `Every post across Blyp · source: ${data.sourceTable}` : "Every post across Blyp"}
        actions={<button className="btn ghost tiny" onClick={() => res.reload()}>Refresh</button>}
      />

      <div className="card row wrap" style={{ marginBottom: 14, padding: 12, gap: 10 }}>
        <input className="grow" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search post text…" style={{ minWidth: 240 }} />
        <div className="row" style={{ gap: 6 }}>
          {(["all", "live", "removed"] as RemovedFilter[]).map((f) => (
            <button key={f} className={removed === f ? "btn tiny" : "btn ghost tiny"} onClick={() => setRemoved(f)} style={{ textTransform: "capitalize" }}>{f}</button>
          ))}
        </div>
      </div>

      {res.loading && <Spinner label="Loading posts…" />}
      {res.error && <ErrorNote>{res.error}</ErrorNote>}
      {data?.degraded && <ErrorNote>{data.detail}</ErrorNote>}

      {data && !res.loading && (
        data.items.length === 0 ? (
          <EmptyState>No posts match the current filters.</EmptyState>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
              {data.items.map((p) => (
                <div key={p.postId} className="card" style={{ padding: 10, opacity: p.isRemoved ? 0.6 : 1 }}>
                  <Thumb post={p} />
                  <div className="row" style={{ gap: 8, marginTop: 10, cursor: "pointer" }} onClick={() => navigate(`/people/${encodeURIComponent(p.userId)}`)}>
                    <span style={{ width: 24, height: 24, borderRadius: 7, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, rgba(0,210,190,0.25), rgba(103,232,249,0.18))", color: "var(--brand-light)", fontSize: 10, fontWeight: 800 }}>
                      {initials(p.authorDisplayName || p.authorUsername, p.userId)}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.authorDisplayName || p.authorUsername || p.userId.slice(0, 12)}</div>
                      <div className="dim" style={{ fontSize: 10 }}>{fmtRelative(p.createdAt)}</div>
                    </div>
                  </div>
                  {p.content && <div className="muted" style={{ fontSize: 12, marginTop: 8, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{p.content}</div>}
                  <div className="row" style={{ gap: 12, marginTop: 8, fontSize: 11, color: "var(--text-2)" }}>
                    <span>♥ {p.likes.toLocaleString()}</span>
                    <span>👁 {p.views.toLocaleString()}</span>
                    <span>💬 {p.comments.toLocaleString()}</span>
                  </div>
                  <div className="row spread" style={{ marginTop: 10 }}>
                    {p.isRemoved ? <Badge kind="err">Removed</Badge> : <Badge kind="ok">Live</Badge>}
                    <button className={p.isRemoved ? "btn success tiny" : "btn danger tiny"} disabled={busy === p.postId} onClick={() => moderate(p)}>
                      {busy === p.postId ? "…" : p.isRemoved ? "Restore" : "Remove"}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="row spread" style={{ marginTop: 16 }}>
              <button className="btn ghost tiny" disabled={effectiveOffset === 0} onClick={() => setOffset(Math.max(0, effectiveOffset - PAGE))}>← Previous</button>
              <span className="muted" style={{ fontSize: 12 }}>{total.toLocaleString()} posts</span>
              <button className="btn ghost tiny" disabled={effectiveOffset + PAGE >= total} onClick={() => setOffset(effectiveOffset + PAGE)}>Next →</button>
            </div>
          </>
        )
      )}
    </div>
  );
}
