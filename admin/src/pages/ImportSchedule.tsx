import { useMemo, useState } from "react";
import { api } from "../api/client";
import { useAsync } from "../lib/useAsync";
import { fmtRelative } from "../lib/format";
import { PageHeader, Spinner, ErrorNote, EmptyState, Badge } from "../components/ui";
import { useToast } from "../components/Toast";

type ScheduledItem = {
  postId: string;
  userId: string;
  title: string;
  publishStatus: string;
  publishAt: number | null;
  importId: string | null;
  sourcePlatform: string | null;
  sourceAccount: string | null;
  thumbnailUrl: string | null;
};

type ImportRow = {
  id: string;
  uid: string;
  platform: string;
  handle: string;
  status: string;
  done: number;
  scheduled: number;
  total: number;
  message: string;
  createdAt: number | null;
  stagger?: { enabled?: boolean; postsPerDay?: number; isAdmin?: boolean } | null;
};

export default function ImportSchedule() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<"all" | "scheduled" | "paused">("all");
  const [uid, setUid] = useState("");
  const [handle, setHandle] = useState("");
  const [platform, setPlatform] = useState<"tiktok" | "youtube">("tiktok");
  const [postsPerDay, setPostsPerDay] = useState(8);

  const schedKey = `${status}`;
  const scheduled = useAsync<{ items: ScheduledItem[]; total: number }>(
    () => api.get(`/admin/scheduled-posts?status=${status}&limit=100`),
    [schedKey],
  );
  const imports = useAsync<{ items: ImportRow[] }>(
    () => api.get("/admin/social-imports?limit=40"),
    [],
  );

  const items = scheduled.data?.items || [];
  const importItems = imports.data?.items || [];

  const nextLive = useMemo(() => {
    const due = items
      .filter((i) => i.publishStatus === "scheduled" && i.publishAt)
      .sort((a, b) => (a.publishAt || 0) - (b.publishAt || 0));
    return due[0] || null;
  }, [items]);

  async function act(postId: string, action: "publish_now" | "pause" | "cancel") {
    setBusy(postId + action);
    try {
      await api.post(`/admin/scheduled-posts/${encodeURIComponent(postId)}/action`, { action });
      toast.push(`${action.replace("_", " ")} ┬À ${postId.slice(0, 8)}…`, "ok");
      scheduled.reload();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : String(e), "err");
    } finally {
      setBusy(null);
    }
  }

  async function createImport() {
    if (!uid.trim() || !handle.trim()) {
      toast.push("User id and handle required", "err");
      return;
    }
    setBusy("create");
    try {
      const body = {
        uid: uid.trim(),
        platform,
        handle: handle.trim(),
        stagger: { enabled: true, postsPerDay, startAt: Date.now(), isAdmin: true },
      };
      const out = await api.post<{ ok: boolean; id: string }>("/admin/social-imports", body);
      toast.push(`Import queued ┬À ${out.id}`, "ok");
      setHandle("");
      imports.reload();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : String(e), "err");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Import & schedule"
        subtitle="Bulk ingest from TikTok/YouTube, then publish over time — not dump-all-live"
        actions={
          <button className="btn ghost tiny" onClick={() => { scheduled.reload(); imports.reload(); }}>
            Refresh
          </button>
        }
      />

      <div className="card" style={{ marginBottom: 14, padding: 14 }}>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
          Staff seed (admin caps: up to 48/day). Uses <code>content.moderate</code>. Worker must be running.
        </div>
        <div className="row wrap" style={{ gap: 10 }}>
          <input
            placeholder="Target user id (Cognito sub)"
            value={uid}
            onChange={(e) => setUid(e.target.value)}
            style={{ minWidth: 260, flex: 1 }}
          />
          <input
            placeholder="@handle or channel URL"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            style={{ minWidth: 180, flex: 1 }}
          />
          <select value={platform} onChange={(e) => setPlatform(e.target.value as "tiktok" | "youtube")}>
            <option value="tiktok">TikTok</option>
            <option value="youtube">YouTube</option>
          </select>
          <select value={postsPerDay} onChange={(e) => setPostsPerDay(Number(e.target.value))}>
            {[3, 5, 8, 12, 24, 48].map((n) => (
              <option key={n} value={n}>{n}/day</option>
            ))}
          </select>
          <button className="btn" disabled={busy === "create"} onClick={createImport}>
            {busy === "create" ? "Queuing…" : "Queue staggered import"}
          </button>
        </div>
      </div>

      <div className="card row wrap" style={{ marginBottom: 14, padding: 12, gap: 10 }}>
        <span className="muted" style={{ fontSize: 12 }}>Queue filter</span>
        {(["all", "scheduled", "paused"] as const).map((s) => (
          <button
            key={s}
            className={`btn tiny ${status === s ? "" : "ghost"}`}
            onClick={() => setStatus(s)}
          >
            {s}
          </button>
        ))}
        {nextLive?.publishAt && (
          <Badge kind="ok">Next live {fmtRelative(new Date(nextLive.publishAt).toISOString())}</Badge>
        )}
        <span className="muted" style={{ fontSize: 12, marginLeft: "auto" }}>
          {scheduled.data?.total ?? 0} in queue
        </span>
      </div>

      {scheduled.loading && !scheduled.data ? <Spinner /> : null}
      {scheduled.error ? <ErrorNote>{String(scheduled.error)}</ErrorNote> : null}

      {!scheduled.loading && items.length === 0 ? (
        <EmptyState>No scheduled posts. Imports with pace enabled land here until the publish sweeper flips them live.</EmptyState>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Status</th>
                <th>Title</th>
                <th>User</th>
                <th>Source</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.postId}>
                  <td className="mono" style={{ fontSize: 12 }}>
                    {p.publishAt ? fmtRelative(new Date(p.publishAt).toISOString()) : "—"}
                  </td>
                  <td><Badge kind="info">{p.publishStatus}</Badge></td>
                  <td style={{ maxWidth: 220 }}>{p.title || "—"}</td>
                  <td className="mono" style={{ fontSize: 11 }}>{p.userId.slice(0, 12)}…</td>
                  <td style={{ fontSize: 12 }}>
                    {p.sourcePlatform || "—"}{p.sourceAccount ? ` @${p.sourceAccount}` : ""}
                  </td>
                  <td className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                    <button className="btn tiny" disabled={!!busy} onClick={() => act(p.postId, "publish_now")}>Now</button>
                    <button className="btn tiny ghost" disabled={!!busy} onClick={() => act(p.postId, "pause")}>Pause</button>
                    <button className="btn tiny ghost" disabled={!!busy} onClick={() => act(p.postId, "cancel")}>Cancel</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 style={{ marginTop: 28, marginBottom: 10 }}>Recent import jobs</h3>
      {imports.loading && !imports.data ? <Spinner /> : null}
      {importItems.length === 0 && !imports.loading ? (
        <EmptyState>No import jobs yet</EmptyState>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Status</th>
                <th>Handle</th>
                <th>Progress</th>
                <th>Pace</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {importItems.map((r) => (
                <tr key={r.id}>
                  <td className="mono" style={{ fontSize: 12 }}>
                    {r.createdAt ? fmtRelative(new Date(r.createdAt).toISOString()) : "—"}
                  </td>
                  <td><Badge kind="neutral">{r.status}</Badge></td>
                  <td>@{r.handle} ┬À {r.platform}</td>
                  <td className="mono" style={{ fontSize: 12 }}>
                    {r.done}/{r.total || "?"}{r.scheduled ? ` ┬À ${r.scheduled} queued` : ""}
                  </td>
                  <td style={{ fontSize: 12 }}>
                    {r.stagger?.enabled === false
                      ? "instant"
                      : `${r.stagger?.postsPerDay || "?"} /day${r.stagger?.isAdmin ? " ┬À admin" : ""}`}
                  </td>
                  <td className="muted" style={{ fontSize: 12, maxWidth: 280 }}>{r.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
