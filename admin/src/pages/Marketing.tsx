import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/useAuth";
import { useAsync } from "../lib/useAsync";
import { fmtRelative } from "../lib/format";
import {
  PageHeader,
  Spinner,
  ErrorNote,
  EmptyState,
  Badge,
  InfoNote,
  WarnNote,
} from "../components/ui";
import { useToast } from "../components/Toast";

type Tab = "accounts" | "sources" | "schedule" | "queue";

type Network = "facebook" | "instagram" | "tiktok" | "snapchat";

type Capability = {
  network: Network;
  label: string;
  oauthReady: boolean;
  publishReady: boolean;
  statusHint: "ready" | "needs_env" | "coming_soon";
  detail: string;
};

type Account = {
  accountId: string;
  network: Network;
  status: string;
  displayName: string | null;
  externalUserId: string | null;
  externalPageId: string | null;
  tokenExpiresAt: string | null;
  hasToken: boolean;
  metadata?: Record<string, unknown>;
};

type AccountsResponse = {
  accounts: Account[];
  capabilities: Capability[];
  metaRedirectUri: string;
};

type SourceItem = {
  sourceType: "blyp_post" | "promo_template";
  sourceId: string;
  title: string;
  caption: string;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  linkUrl: string;
  authorLabel?: string;
};

type SourcesResponse = {
  recentPosts: SourceItem[];
  promoTemplates: SourceItem[];
  featuredNote: string;
};

type Schedule = {
  scheduleId: string;
  enabled: boolean;
  timezone: string;
  daysOfWeek: number[];
  timesLocal: string[];
  sourceMode: "recent_public" | "featured" | "promo_template" | "manual";
  captionTemplate: string | null;
  networks: Network[];
  lastEnqueuedSlot: string | null;
};

type QueueItem = {
  itemId: string;
  network: Network;
  status: string;
  scheduledAt: string;
  publishedAt: string | null;
  sourceType: string;
  sourcePostId: string | null;
  caption: string;
  mediaUrl: string | null;
  permalink: string | null;
  externalPostId: string | null;
  errorCode: string | null;
  errorDetail: string | null;
  attempts: number;
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function statusBadge(status: string) {
  if (status === "connected" || status === "published") return <Badge kind="ok">{status}</Badge>;
  if (status === "coming_soon" || status === "scheduled" || status === "publishing") {
    return <Badge kind="info">{status.replace("_", " ")}</Badge>;
  }
  if (status === "failed" || status === "needs_auth") return <Badge kind="err">{status.replace("_", " ")}</Badge>;
  if (status === "disconnected" || status === "cancelled") return <Badge kind="neutral">{status}</Badge>;
  return <Badge kind="warn">{status}</Badge>;
}

export default function Marketing() {
  const { can } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const canManage = can("marketing.manage");
  const [tab, setTab] = useState<Tab>("accounts");
  const [busy, setBusy] = useState<string | null>(null);
  const [queueFilter, setQueueFilter] = useState<"all" | "scheduled" | "published" | "failed">("all");
  const [selectedSource, setSelectedSource] = useState<SourceItem | null>(null);
  const [enqueueNetworks, setEnqueueNetworks] = useState<Network[]>(["facebook"]);
  const [scheduleDraft, setScheduleDraft] = useState<Schedule | null>(null);

  const accounts = useAsync<AccountsResponse>(
    () => api.get<AccountsResponse>("/admin/marketing/accounts"),
    [],
  );
  const sources = useAsync<SourcesResponse>(
    () => api.get<SourcesResponse>("/admin/marketing/sources"),
    [],
  );
  const schedule = useAsync<{ schedule: Schedule }>(
    () => api.get<{ schedule: Schedule }>("/admin/marketing/schedule"),
    [],
  );
  const scheduleView = scheduleDraft ?? schedule.data?.schedule ?? null;
  const queueKey = queueFilter;
  const queue = useAsync<{ items: QueueItem[]; total: number }>(
    () => api.get(`/admin/marketing/queue?status=${queueFilter}&limit=50`),
    [queueKey],
  );

  useEffect(() => {
    const oauth = params.get("oauth");
    const network = params.get("network");
    const code = params.get("code");
    if (!oauth) return;
    if (oauth === "ok") {
      toast.push(`Connected ${network || "account"}`, "ok");
      accounts.reload();
    } else {
      toast.push(`OAuth failed${code ? `: ${code}` : ""}`, "err");
    }
    setParams({}, { replace: true });
  }, [params, setParams, toast, accounts]);

  const capByNet = useMemo(() => {
    const m = new Map<string, Capability>();
    for (const c of accounts.data?.capabilities || []) m.set(c.network, c);
    return m;
  }, [accounts.data]);

  async function connectMeta(network: "facebook" | "instagram") {
    if (!canManage) return;
    setBusy(`connect-${network}`);
    try {
      const out = await api.post<{ authUrl: string }>("/admin/marketing/accounts/meta/start", { network });
      window.location.assign(out.authUrl);
    } catch (e) {
      toast.push(e instanceof Error ? e.message : String(e), "err");
      setBusy(null);
    }
  }

  async function disconnect(network: Network) {
    if (!canManage) return;
    if (!window.confirm(`Disconnect ${network}? Tokens are wiped.`)) return;
    setBusy(`disc-${network}`);
    try {
      await api.post("/admin/marketing/accounts/disconnect", { network });
      toast.push(`Disconnected ${network}`, "ok");
      accounts.reload();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : String(e), "err");
    } finally {
      setBusy(null);
    }
  }

  async function saveSchedule() {
    if (!canManage || !scheduleView) return;
    setBusy("schedule");
    try {
      const out = await api.post<{ schedule: Schedule }>("/admin/marketing/schedule", {
        enabled: scheduleView.enabled,
        timezone: scheduleView.timezone,
        daysOfWeek: scheduleView.daysOfWeek,
        timesLocal: scheduleView.timesLocal,
        sourceMode: scheduleView.sourceMode,
        captionTemplate: scheduleView.captionTemplate,
        networks: scheduleView.networks,
      });
      setScheduleDraft(out.schedule);
      toast.push(out.schedule.enabled ? "Schedule saved · enabled" : "Schedule saved · paused", "ok");
      schedule.reload();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : String(e), "err");
    } finally {
      setBusy(null);
    }
  }

  async function enqueueSelected() {
    if (!canManage || !selectedSource) {
      toast.push("Pick a content source first", "err");
      return;
    }
    setBusy("enqueue");
    try {
      const out = await api.post<{ items: QueueItem[] }>("/admin/marketing/queue", {
        networks: enqueueNetworks,
        sourceType: selectedSource.sourceType,
        sourceId: selectedSource.sourceId,
        caption: selectedSource.caption,
        mediaUrl: selectedSource.mediaUrl,
        linkUrl: selectedSource.linkUrl,
      });
      const failed = out.items.filter((i) => i.status === "failed").length;
      toast.push(
        `Queued ${out.items.length} item(s)${failed ? ` · ${failed} failed (not connected)` : ""}`,
        failed ? "info" : "ok",
      );
      queue.reload();
      setTab("queue");
    } catch (e) {
      toast.push(e instanceof Error ? e.message : String(e), "err");
    } finally {
      setBusy(null);
    }
  }

  async function queueAction(itemId: string, action: "cancel" | "publish-now") {
    if (!canManage) return;
    setBusy(itemId + action);
    try {
      await api.post(`/admin/marketing/queue/${encodeURIComponent(itemId)}/${action}`);
      toast.push(action === "cancel" ? "Cancelled" : "Publish attempted", "ok");
      queue.reload();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : String(e), "err");
      queue.reload();
    } finally {
      setBusy(null);
    }
  }

  function toggleDay(d: number) {
    if (!scheduleView) return;
    const set = new Set(scheduleView.daysOfWeek);
    if (set.has(d)) set.delete(d);
    else set.add(d);
    const days = Array.from(set).sort((a, b) => a - b);
    if (!days.length) return;
    setScheduleDraft({ ...scheduleView, daysOfWeek: days });
  }

  function toggleScheduleNetwork(n: Network) {
    if (!scheduleView) return;
    const set = new Set(scheduleView.networks);
    if (set.has(n)) set.delete(n);
    else set.add(n);
    const networks = Array.from(set) as Network[];
    if (!networks.length) return;
    setScheduleDraft({ ...scheduleView, networks });
  }

  if (!canManage) {
    return (
      <div>
        <PageHeader title="Marketing" subtitle="Social account linking and scheduled Blyp posts" />
        <WarnNote>
          Need <code>marketing.manage</code> (Owner, Executive, or Administrator/Mel).
        </WarnNote>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Marketing"
        subtitle="Connect social accounts, pull Blyp content, schedule honest auto-posts"
        actions={
          <button
            className="btn ghost tiny"
            type="button"
            onClick={() => {
              accounts.reload();
              sources.reload();
              schedule.reload();
              queue.reload();
            }}
          >
            Refresh
          </button>
        }
      />

      <InfoNote>
        Meta (Facebook + Instagram) publish is live when env secrets are set. TikTok and Snapchat are scaffolded —
        UI never claims a post succeeded without a real API call. See <code>admin/MARKETING_HUB.md</code>.
      </InfoNote>

      <div className="row wrap" style={{ gap: 6, margin: "14px 0" }}>
        {(
          [
            ["accounts", "Connected accounts"],
            ["sources", "Content sources"],
            ["schedule", "Schedule"],
            ["queue", "Queue / history"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={tab === key ? "btn tiny" : "btn ghost tiny"}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "accounts" && (
        <div className="stack" style={{ gap: 12 }}>
          {accounts.loading && <Spinner label="Loading accounts…" />}
          {accounts.error && <ErrorNote>{accounts.error}</ErrorNote>}
          {accounts.data && (
            <>
              <div className="dim" style={{ fontSize: 12 }}>
                OAuth redirect URI (Meta app): <code>{accounts.data.metaRedirectUri}</code>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
                {accounts.data.accounts.map((a) => {
                  const cap = capByNet.get(a.network);
                  const connected = a.status === "connected" && a.hasToken;
                  const comingSoon = a.status === "coming_soon" || cap?.statusHint === "coming_soon";
                  const needsEnv = cap?.statusHint === "needs_env" && !connected;
                  return (
                    <div key={a.network} className="card" style={{ padding: 14 }}>
                      <div className="row spread" style={{ marginBottom: 8 }}>
                        <strong style={{ textTransform: "capitalize" }}>{a.network}</strong>
                        {comingSoon
                          ? statusBadge("coming_soon")
                          : connected
                            ? statusBadge("connected")
                            : needsEnv
                              ? statusBadge("needs_auth")
                              : statusBadge(a.status || "disconnected")}
                      </div>
                      <div className="muted" style={{ fontSize: 12, minHeight: 36, lineHeight: 1.4 }}>
                        {connected
                          ? a.displayName || a.externalPageId || "Connected"
                          : cap?.detail || "Not connected"}
                      </div>
                      {a.tokenExpiresAt && (
                        <div className="dim" style={{ fontSize: 11, marginTop: 6 }}>
                          Token expires {fmtRelative(a.tokenExpiresAt)}
                        </div>
                      )}
                      <div className="row" style={{ gap: 8, marginTop: 12 }}>
                        {(a.network === "facebook" || a.network === "instagram") && !comingSoon && (
                          <button
                            type="button"
                            className="btn tiny"
                            disabled={Boolean(busy) || !cap?.oauthReady}
                            title={!cap?.oauthReady ? cap?.detail : undefined}
                            onClick={() => connectMeta(a.network as "facebook" | "instagram")}
                          >
                            {busy === `connect-${a.network}` ? "…" : connected ? "Re-connect" : "Connect"}
                          </button>
                        )}
                        {connected && (
                          <button
                            type="button"
                            className="btn ghost tiny"
                            disabled={Boolean(busy)}
                            onClick={() => disconnect(a.network)}
                          >
                            Disconnect
                          </button>
                        )}
                        {comingSoon && (
                          <span className="dim" style={{ fontSize: 11 }}>
                            Configure env when API access is approved
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {tab === "sources" && (
        <div className="stack" style={{ gap: 14 }}>
          {sources.loading && <Spinner label="Loading Blyp content…" />}
          {sources.error && <ErrorNote>{sources.error}</ErrorNote>}
          {sources.data && (
            <>
              <WarnNote>{sources.data.featuredNote}</WarnNote>
              <div className="card" style={{ padding: 12 }}>
                <h3 className="panel-title">Queue selection</h3>
                <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                  Selected: {selectedSource ? selectedSource.title : "none"}
                </div>
                <div className="row wrap" style={{ gap: 6, marginBottom: 10 }}>
                  {(["facebook", "instagram", "tiktok", "snapchat"] as Network[]).map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={enqueueNetworks.includes(n) ? "btn tiny" : "btn ghost tiny"}
                      style={{ textTransform: "capitalize" }}
                      onClick={() => {
                        setEnqueueNetworks((prev) =>
                          prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n],
                        );
                      }}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="btn tiny"
                  disabled={!selectedSource || !enqueueNetworks.length || busy === "enqueue"}
                  onClick={enqueueSelected}
                >
                  {busy === "enqueue" ? "…" : "Add to queue"}
                </button>
              </div>

              <h3 className="panel-title">Recent public posts</h3>
              {sources.data.recentPosts.length === 0 ? (
                <EmptyState>No live posts available from Blyp.</EmptyState>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
                  {sources.data.recentPosts.map((p) => (
                    <button
                      key={p.sourceId}
                      type="button"
                      className="card"
                      style={{
                        padding: 10,
                        textAlign: "left",
                        cursor: "pointer",
                        borderColor:
                          selectedSource?.sourceId === p.sourceId ? "var(--brand)" : undefined,
                      }}
                      onClick={() => setSelectedSource(p)}
                    >
                      {p.thumbnailUrl ? (
                        <img
                          src={p.thumbnailUrl}
                          alt=""
                          loading="lazy"
                          style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 8 }}
                        />
                      ) : (
                        <div
                          style={{
                            aspectRatio: "1",
                            borderRadius: 8,
                            background: "var(--surface-2)",
                            display: "grid",
                            placeItems: "center",
                            fontSize: 11,
                            color: "var(--text-muted)",
                          }}
                        >
                          No thumb
                        </div>
                      )}
                      <div style={{ fontSize: 12, fontWeight: 600, marginTop: 8 }}>{p.authorLabel}</div>
                      <div className="muted" style={{ fontSize: 11, marginTop: 4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                        {p.caption || p.title}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              <h3 className="panel-title" style={{ marginTop: 8 }}>
                Promo templates
              </h3>
              <div style={{ display: "grid", gap: 8 }}>
                {sources.data.promoTemplates.map((t) => (
                  <button
                    key={t.sourceId}
                    type="button"
                    className="card"
                    style={{
                      padding: 12,
                      textAlign: "left",
                      borderColor: selectedSource?.sourceId === t.sourceId ? "var(--brand)" : undefined,
                    }}
                    onClick={() => setSelectedSource(t)}
                  >
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{t.sourceId}</div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{t.caption}</div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {tab === "schedule" && (
        <div className="card stack" style={{ maxWidth: 640, padding: 16, gap: 12 }}>
          {schedule.loading && <Spinner label="Loading schedule…" />}
          {schedule.error && <ErrorNote>{schedule.error}</ErrorNote>}
          {scheduleView && (
            <>
              <div className="row spread">
                <h3 className="panel-title" style={{ margin: 0 }}>
                  Auto-post schedule
                </h3>
                <button
                  type="button"
                  className={scheduleView.enabled ? "btn success tiny" : "btn ghost tiny"}
                  onClick={() => setScheduleDraft({ ...scheduleView, enabled: !scheduleView.enabled })}
                >
                  {scheduleView.enabled ? "Enabled" : "Paused"}
                </button>
              </div>
              <InfoNote>
                Worker runs via Cloud Scheduler → <code>POST /internal/cron/marketing-publish</code> (every ~5 min).
                Slots match within ±4 minutes local time; each slot enqueues once.
              </InfoNote>
              <label>
                Timezone (IANA)
                <input
                  value={scheduleView.timezone}
                  onChange={(e) => setScheduleDraft({ ...scheduleView, timezone: e.target.value })}
                />
              </label>
              <div>
                <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Days</div>
                <div className="row wrap" style={{ gap: 6 }}>
                  {DAY_LABELS.map((label, i) => (
                    <button
                      key={label}
                      type="button"
                      className={scheduleView.daysOfWeek.includes(i) ? "btn tiny" : "btn ghost tiny"}
                      onClick={() => toggleDay(i)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <label>
                Times (HH:MM, comma-separated)
                <input
                  value={scheduleView.timesLocal.join(", ")}
                  onChange={(e) =>
                    setScheduleDraft({
                      ...scheduleView,
                      timesLocal: e.target.value
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </label>
              <label>
                Source mode
                <select
                  value={scheduleView.sourceMode}
                  onChange={(e) =>
                    setScheduleDraft({
                      ...scheduleView,
                      sourceMode: e.target.value as Schedule["sourceMode"],
                    })
                  }
                >
                  <option value="recent_public">Recent public posts</option>
                  <option value="featured">Featured (same as recent for v1)</option>
                  <option value="promo_template">Promo templates (rotate)</option>
                  <option value="manual">Manual only (no auto-pick)</option>
                </select>
              </label>
              <label>
                Caption template
                <textarea
                  rows={3}
                  value={scheduleView.captionTemplate || ""}
                  onChange={(e) => setScheduleDraft({ ...scheduleView, captionTemplate: e.target.value })}
                  placeholder="{caption}&#10;&#10;Watch on Blyp: {link}"
                />
              </label>
              <div>
                <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Networks</div>
                <div className="row wrap" style={{ gap: 6 }}>
                  {(["facebook", "instagram", "tiktok", "snapchat"] as Network[]).map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={scheduleView.networks.includes(n) ? "btn tiny" : "btn ghost tiny"}
                      style={{ textTransform: "capitalize" }}
                      onClick={() => toggleScheduleNetwork(n)}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              {scheduleView.lastEnqueuedSlot && (
                <div className="dim" style={{ fontSize: 11 }}>
                  Last enqueued slot: {scheduleView.lastEnqueuedSlot}
                </div>
              )}
              <button type="button" className="btn" disabled={busy === "schedule"} onClick={saveSchedule}>
                {busy === "schedule" ? "Saving…" : "Save schedule"}
              </button>
            </>
          )}
        </div>
      )}

      {tab === "queue" && (
        <div className="stack" style={{ gap: 12 }}>
          <div className="row wrap" style={{ gap: 6 }}>
            {(["all", "scheduled", "published", "failed"] as const).map((f) => (
              <button
                key={f}
                type="button"
                className={queueFilter === f ? "btn tiny" : "btn ghost tiny"}
                style={{ textTransform: "capitalize" }}
                onClick={() => setQueueFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>
          {queue.loading && <Spinner label="Loading queue…" />}
          {queue.error && <ErrorNote>{queue.error}</ErrorNote>}
          {queue.data && queue.data.items.length === 0 && <EmptyState>No queue items.</EmptyState>}
          {queue.data && queue.data.items.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Network</th>
                    <th>Status</th>
                    <th>Caption</th>
                    <th>Error</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {queue.data.items.map((item) => (
                    <tr key={item.itemId}>
                      <td style={{ whiteSpace: "nowrap", fontSize: 12 }}>
                        {fmtRelative(item.scheduledAt)}
                        {item.publishedAt && (
                          <div className="dim">pub {fmtRelative(item.publishedAt)}</div>
                        )}
                      </td>
                      <td style={{ textTransform: "capitalize" }}>{item.network}</td>
                      <td>{statusBadge(item.status)}</td>
                      <td style={{ maxWidth: 240, fontSize: 12 }}>
                        <div style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                          {item.caption}
                        </div>
                        {item.externalPostId && (
                          <div className="dim" style={{ fontSize: 10 }}>ext {item.externalPostId}</div>
                        )}
                      </td>
                      <td style={{ fontSize: 11, color: "var(--error)", maxWidth: 180 }}>
                        {item.errorDetail || item.errorCode || "—"}
                      </td>
                      <td>
                        <div className="row" style={{ gap: 4 }}>
                          {item.status === "scheduled" && (
                            <button
                              type="button"
                              className="btn tiny"
                              disabled={Boolean(busy)}
                              onClick={() => queueAction(item.itemId, "publish-now")}
                            >
                              Publish
                            </button>
                          )}
                          {(item.status === "scheduled" || item.status === "failed") && (
                            <button
                              type="button"
                              className="btn ghost tiny"
                              disabled={Boolean(busy)}
                              onClick={() => queueAction(item.itemId, "cancel")}
                            >
                              Cancel
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
