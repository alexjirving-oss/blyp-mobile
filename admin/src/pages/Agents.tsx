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
};

type AgentsDirectory = {
  items: AgentSettings[];
  global: { paused: boolean; forceSuggestOnly: boolean; updatedBy: string | null; updatedAt: string | null };
  defaults?: { mode: string; allowPost: boolean; note: string };
};

type ProposalsResponse = { items: AgentProposal[]; pendingCount: number };

export default function Agents() {
  const { can } = useAuth();
  const canOversee = can("agents.oversight");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [seedUserId, setSeedUserId] = useState("");
  const [seedText, setSeedText] = useState("Looks great — thanks for sharing.");
  const [seedContext, setSeedContext] = useState("Reply to a followed creator's new post (demo proposal).");

  const directory = useAsync<AgentsDirectory>(() => api.get("/admin/agents"), []);
  const proposals = useAsync<ProposalsResponse>(
    () => api.get("/admin/agents/proposals?status=pending"),
    [],
  );

  const reload = () => {
    setErr(null);
    directory.reload();
    proposals.reload();
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
    try {
      await api.post(`/admin/agents/proposals/${encodeURIComponent(proposalId)}/${decision}`, {});
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
      // Ensure a settings row exists for directory visibility.
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

  return (
    <div>
      <PageHeader
        title="Agent oversight"
        subtitle="Boss console for busy-person agents — suggest_only / approve queue (no spam auto-post)"
        actions={
          <button className="btn ghost tiny" onClick={reload} disabled={busy}>
            Refresh
          </button>
        }
      />

      <InfoNote>
        Default mode is <code>suggest_only</code>. The proposal worker queues comment ideas when followed creators post; approvals mark them ready — the executor is not shipped, so nothing posts automatically.
      </InfoNote>

      {err && (
        <div style={{ marginTop: 12 }}>
          <ErrorNote>{err}</ErrorNote>
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
                <Badge kind="info">force suggest_only: {String(g.forceSuggestOnly)}</Badge>
              </div>
              {canOversee ? (
                <div className="row" style={{ gap: 8, marginTop: 8 }}>
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
                </div>
              ) : (
                <WarnNote>Owner-only mutations (<code>agents.oversight</code>). View access remains for staff.</WarnNote>
              )}
            </>
          )}
        </div>

        <div className="card stack">
          <h3 className="panel-title">Approve queue</h3>
          <div className="row" style={{ gap: 8 }}>
            <Badge kind={pendingCount > 0 ? "warn" : "ok"}>{pendingCount} pending</Badge>
          </div>
          <p className="dim" style={{ fontSize: 12.5, margin: 0 }}>
            Human approve/reject only. Auto-post capability is hard-disabled in MVP.
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
                  <Link to={`/people/${encodeURIComponent(p.userId)}`} className="mono" style={{ fontSize: 12 }}>
                    {p.userId.slice(0, 12)}…
                  </Link>
                  <span className="dim" style={{ fontSize: 11, marginLeft: 8 }}>
                    {fmtRelative(p.createdAt)}
                  </span>
                </div>
                {canOversee && (
                  <div className="row" style={{ gap: 6 }}>
                    <button className="btn tiny" disabled={busy} onClick={() => review(p.proposalId, "approve")}>
                      Approve
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
          <p className="dim" style={{ margin: 0 }}>No agent profiles yet. Seed a demo proposal below (Owner).</p>
        )}
        <div className="stack" style={{ gap: 8 }}>
          {items.map((s) => (
            <div key={s.userId} className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <div>
                <Link to={`/people/${encodeURIComponent(s.userId)}`} className="mono" style={{ fontSize: 12 }}>
                  {s.userId}
                </Link>
                <div className="dim" style={{ fontSize: 12 }}>
                  mode={s.mode} · max/day={s.maxActionsPerDay} · updated {fmtRelative(s.updatedAt)}
                </div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <Badge kind={s.enabled ? "ok" : "warn"}>{s.enabled ? "on" : "off"}</Badge>
                <Badge kind="info">post={String(s.allowPost)}</Badge>
              </div>
            </div>
          ))}
        </div>
      </div>

      {canOversee && (
        <div className="card stack" style={{ marginTop: 14 }}>
          <h3 className="panel-title">Seed demo proposal (Owner)</h3>
          <p className="dim" style={{ fontSize: 12.5, marginTop: 0 }}>
            Creates a pending comment proposal + enables suggest_only settings for a Cognito sub. Does not post.
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
