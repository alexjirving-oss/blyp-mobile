import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useAsync } from "../lib/useAsync";
import { fmtRelative } from "../lib/format";
import { PageHeader, Spinner, ErrorNote, Badge, InfoNote, WarnNote } from "../components/ui";
import { useAuth } from "../auth/useAuth";

type AgentSettings = {
  userId: string;
  enabled: boolean;
  mode: string;
  allowComment: boolean;
  allowReply: boolean;
  allowReact: boolean;
  allowPost: boolean;
  maxActionsPerDay: number;
  updatedAt: string | null;
};

type AgentProposal = {
  proposalId: string;
  userId: string;
  actionType: string;
  status: string;
  proposedText: string | null;
  contextSummary: string | null;
  createdAt: string | null;
  executedAt?: string | null;
};

type AgentLog = {
  logId: string;
  userId: string;
  actionType: string;
  outcome: string;
  detail: string | null;
  createdAt: string | null;
};

type AgentsDirectory = {
  items: AgentSettings[];
  global: { paused: boolean; forceSuggestOnly: boolean; updatedBy: string | null; updatedAt: string | null };
  defaults?: { mode: string; allowPost: boolean; note: string };
};

type ProposalsResponse = { items: AgentProposal[]; pendingCount: number };
type ActivityResponse = { items: AgentLog[] };

export default function Agents() {
  const { can } = useAuth();
  const canOversee = can("agents.oversight");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okNote, setOkNote] = useState<string | null>(null);
  const [seedUserId, setSeedUserId] = useState("");
  const [seedText, setSeedText] = useState("Looks great — thanks for sharing.");
  const [seedContext, setSeedContext] = useState("Reply to a followed creator's new post (demo proposal).");

  const directory = useAsync<AgentsDirectory>(() => api.get("/admin/agents"), []);
  const proposals = useAsync<ProposalsResponse>(
    () => api.get("/admin/agents/proposals?status=pending"),
    [],
  );
  const executed = useAsync<ProposalsResponse>(
    () => api.get("/admin/agents/proposals?status=executed&limit=30"),
    [],
  );
  const activity = useAsync<ActivityResponse>(() => api.get("/admin/agents/activity?limit=40"), []);

  const reload = () => {
    setErr(null);
    setOkNote(null);
    directory.reload();
    proposals.reload();
    executed.reload();
    activity.reload();
  };

  const setGlobal = async (patch: { paused?: boolean; forceSuggestOnly?: boolean }) => {
    if (!canOversee) return;
    setBusy(true);
    setErr(null);
    try {
      await api.post("/admin/agents/global", patch);
      reload();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const review = async (proposalId: string, decision: "approve" | "reject") => {
    if (!canOversee) return;
    setBusy(true);
    setErr(null);
    setOkNote(null);
    try {
      const out = await api.post<{ note?: string }>(
        `/admin/agents/proposals/${encodeURIComponent(proposalId)}/${decision}`,
        {},
      );
      setOkNote(out?.note || null);
      reload();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const seedProposal = async () => {
    if (!canOversee || !seedUserId.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await api.post("/admin/agents/proposals", {
        userId: seedUserId.trim(),
        actionType: "comment",
        proposedText: seedText,
        contextSummary: seedContext,
        targetType: "post",
        targetId: "demo",
      });
      await api.post(`/admin/agents/${encodeURIComponent(seedUserId.trim())}/settings`, {
        enabled: true,
        mode: "suggest_only",
        allowComment: true,
        allowPost: false,
        maxActionsPerDay: 5,
      });
      reload();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const g = directory.data?.global;
  const items = directory.data?.items ?? [];
  const pending = proposals.data?.items ?? [];
  const pendingCount = proposals.data?.pendingCount ?? 0;
  const executedItems = executed.data?.items ?? [];
  const activityItems = activity.data?.items ?? [];

  return (
    <div>
      <PageHeader
        title="Agent oversight"
        subtitle="Boss + Mel console — directory, approve queue, execute log (comments only)"
        actions={
          <button className="btn ghost tiny" onClick={reload} disabled={busy}>
            Refresh
          </button>
        }
      />

      <InfoNote>
        <strong>Live:</strong> propose comments → Boss/Mel approve → execute to Firestore.
        <code> auto_with_limits</code> auto-sends comments only when global force suggest_only is off (daily + ≤3/hour caps).
        <strong> Still suggest-only / hard-off:</strong> posts, gifts, wallet, reply/react auto.
        Default global forceSuggestOnly=true until cleared.
      </InfoNote>

      {err && (
        <div style={{ marginTop: 12 }}>
          <ErrorNote>{err}</ErrorNote>
        </div>
      )}
      {okNote && (
        <div style={{ marginTop: 12 }}>
          <InfoNote>{okNote}</InfoNote>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12, marginTop: 14 }}>
        <div className="card stack">
          <h3 className="panel-title">Global controls</h3>
          {directory.loading && <Spinner />}
          {g && (
            <>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <Badge kind={g.paused ? "warn" : "ok"}>{g.paused ? "PAUSED" : "RUNNING"}</Badge>
                <Badge kind={g.forceSuggestOnly ? "warn" : "info"}>
                  force suggest_only: {String(g.forceSuggestOnly)}
                </Badge>
              </div>
              {canOversee ? (
                <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                  <button className="btn tiny" disabled={busy} onClick={() => setGlobal({ paused: !g.paused })}>
                    {g.paused ? "Resume all" : "Pause all"}
                  </button>
                  <button
                    className="btn ghost tiny"
                    disabled={busy}
                    onClick={() => setGlobal({ forceSuggestOnly: true })}
                  >
                    Force suggest_only
                  </button>
                  <button
                    className="btn ghost tiny"
                    disabled={busy || !g.forceSuggestOnly}
                    onClick={() => setGlobal({ forceSuggestOnly: false })}
                    title="Allows auto_with_limits comment sends under rate caps"
                  >
                    Allow auto_with_limits
                  </button>
                </div>
              ) : (
                <WarnNote>
                  Need <code>agents.oversight</code> (Owner + Mel/admin). View access remains for other staff.
                </WarnNote>
              )}
            </>
          )}
        </div>

        <div className="card stack">
          <h3 className="panel-title">Approve queue</h3>
          <div className="row" style={{ gap: 8 }}>
            <Badge kind={pendingCount > 0 ? "warn" : "ok"}>{pendingCount} pending</Badge>
            <Badge kind="ok">{executedItems.length} recent executed</Badge>
          </div>
          <p className="dim" style={{ fontSize: 12.5, margin: 0 }}>
            Approve sends the comment when the proposal targets a real post (demo targets are skipped).
          </p>
        </div>
      </div>

      <div className="card stack" style={{ marginTop: 14 }}>
        <h3 className="panel-title">Pending proposals</h3>
        {proposals.loading && <Spinner />}
        {proposals.error && <ErrorNote>{proposals.error}</ErrorNote>}
        {!proposals.loading && pending.length === 0 && (
          <p className="dim" style={{ margin: 0 }}>No pending proposals.</p>
        )}
        <div className="stack" style={{ gap: 10 }}>
          {pending.map((p) => (
            <div key={p.proposalId} style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
              <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <div>
                  <Badge kind="info">{p.actionType}</Badge>{" "}
                  <Link to={`/agents/${encodeURIComponent(p.userId)}`} className="mono" style={{ fontSize: 12 }}>
                    {p.userId.slice(0, 12)}…
                  </Link>
                  <span className="dim" style={{ fontSize: 11, marginLeft: 8 }}>
                    {fmtRelative(p.createdAt)}
                  </span>
                </div>
                {canOversee && (
                  <div className="row" style={{ gap: 6 }}>
                    <button className="btn tiny" disabled={busy} onClick={() => review(p.proposalId, "approve")}>
                      Approve & send
                    </button>
                    <button className="btn ghost tiny" disabled={busy} onClick={() => review(p.proposalId, "reject")}>
                      Reject
                    </button>
                  </div>
                )}
              </div>
              <div style={{ fontSize: 13, marginTop: 6 }}>{p.proposedText || "(no text)"}</div>
              <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>
                Context: {p.contextSummary || "—"}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card stack" style={{ marginTop: 14 }}>
        <h3 className="panel-title">Agent directory</h3>
        {directory.loading && <Spinner />}
        {directory.error && <ErrorNote>{directory.error}</ErrorNote>}
        {!directory.loading && items.length === 0 && (
          <p className="dim" style={{ margin: 0 }}>No agent profiles yet. Seed a demo proposal below, or open a person and enable settings.</p>
        )}
        <div className="stack" style={{ gap: 8 }}>
          {items.map((s) => (
            <div key={s.userId} className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <div>
                <Link to={`/agents/${encodeURIComponent(s.userId)}`} className="mono" style={{ fontSize: 12 }}>
                  {s.userId}
                </Link>
                <div className="dim" style={{ fontSize: 12 }}>
                  mode={s.mode} · max/day={s.maxActionsPerDay} · comment={String(s.allowComment)} · updated{" "}
                  {fmtRelative(s.updatedAt)}
                </div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <Badge kind={s.enabled ? "ok" : "warn"}>{s.enabled ? "on" : "off"}</Badge>
                <Badge kind="info">post={String(s.allowPost)}</Badge>
                <Link to={`/agents/${encodeURIComponent(s.userId)}`} className="btn ghost tiny">
                  Manage
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card stack" style={{ marginTop: 14 }}>
        <h3 className="panel-title">Executed comments</h3>
        {executed.loading && <Spinner />}
        {!executed.loading && executedItems.length === 0 && (
          <p className="dim" style={{ margin: 0 }}>No executed proposals yet.</p>
        )}
        {executedItems.map((p) => (
          <div key={p.proposalId} style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <Badge kind="ok">executed</Badge>
              <Link to={`/agents/${encodeURIComponent(p.userId)}`} className="mono" style={{ fontSize: 12 }}>
                {p.userId.slice(0, 12)}…
              </Link>
              <span className="dim" style={{ fontSize: 11 }}>{fmtRelative(p.executedAt || p.createdAt)}</span>
            </div>
            <div style={{ fontSize: 13, marginTop: 4 }}>{p.proposedText || "(no text)"}</div>
          </div>
        ))}
      </div>

      <div className="card stack" style={{ marginTop: 14 }}>
        <h3 className="panel-title">Activity timeline</h3>
        {activity.loading && <Spinner />}
        {!activity.loading && activityItems.length === 0 && (
          <p className="dim" style={{ margin: 0 }}>No activity yet.</p>
        )}
        {activityItems.map((row) => (
          <div key={row.logId} className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <div style={{ fontSize: 13 }}>
              <Badge kind="info">{row.outcome}</Badge>{" "}
              <Link to={`/agents/${encodeURIComponent(row.userId)}`} className="mono" style={{ fontSize: 11 }}>
                {row.userId.slice(0, 10)}…
              </Link>{" "}
              {row.actionType}
              {row.detail ? ` — ${row.detail}` : ""}
            </div>
            <span className="dim" style={{ fontSize: 11 }}>{fmtRelative(row.createdAt)}</span>
          </div>
        ))}
      </div>

      {canOversee && (
        <div className="card stack" style={{ marginTop: 14 }}>
          <h3 className="panel-title">Seed demo proposal</h3>
          <p className="dim" style={{ fontSize: 12.5, marginTop: 0 }}>
            Creates a pending comment + suggest_only settings. Target <code>demo</code> will not post on approve (skipped).
            Use a real post id via API / worker for live send.
          </p>
          <label>User id (Cognito sub)</label>
          <input value={seedUserId} onChange={(e) => setSeedUserId(e.target.value)} placeholder="uuid…" />
          <label>Proposed text</label>
          <input value={seedText} onChange={(e) => setSeedText(e.target.value)} />
          <label>Context summary (required)</label>
          <input value={seedContext} onChange={(e) => setSeedContext(e.target.value)} />
          <button className="btn" disabled={busy || !seedUserId.trim()} onClick={seedProposal}>
            Queue proposal
          </button>
        </div>
      )}
    </div>
  );
}
