import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
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
  styleNotes: string | null;
  topicsAvoid: string | null;
  maxActionsPerDay: number;
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
  updatedAt: string | null;
};

type AgentPhrase = {
  phraseId: string;
  kind: "allow" | "deny";
  text: string;
  createdAt: string | null;
};

type AgentProposal = {
  proposalId: string;
  actionType: string;
  status: string;
  proposedText: string | null;
  contextSummary: string | null;
  targetId: string | null;
  createdAt: string | null;
  executedAt: string | null;
};

type AgentLog = {
  logId: string;
  actionType: string;
  outcome: string;
  detail: string | null;
  actorUserId: string | null;
  createdAt: string | null;
};

type AgentDetailResponse = {
  settings: AgentSettings;
  phrases: AgentPhrase[];
  proposals: AgentProposal[];
  pendingCount: number;
  log: AgentLog[];
  global: { paused: boolean; forceSuggestOnly: boolean };
};

export default function AgentDetail() {
  const { userId = "" } = useParams();
  const { can } = useAuth();
  const canOversee = can("agents.oversight");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okNote, setOkNote] = useState<string | null>(null);

  const detail = useAsync<AgentDetailResponse>(
    () => api.get(`/admin/agents/${encodeURIComponent(userId)}`),
    [userId],
  );

  const s = detail.data?.settings;
  const [enabled, setEnabled] = useState(true);
  const [mode, setMode] = useState("suggest_only");
  const [allowComment, setAllowComment] = useState(true);
  const [maxPerDay, setMaxPerDay] = useState(5);
  const [styleNotes, setStyleNotes] = useState("");
  const [topicsAvoid, setTopicsAvoid] = useState("");
  const [quietStart, setQuietStart] = useState("");
  const [quietEnd, setQuietEnd] = useState("");
  const [phraseText, setPhraseText] = useState("");
  const [phraseKind, setPhraseKind] = useState<"allow" | "deny">("allow");

  useEffect(() => {
    if (!s) return;
    setEnabled(s.enabled);
    setMode(s.mode || "suggest_only");
    setAllowComment(s.allowComment !== false);
    setMaxPerDay(s.maxActionsPerDay ?? 5);
    setStyleNotes(s.styleNotes || "");
    setTopicsAvoid(s.topicsAvoid || "");
    setQuietStart(s.quietHoursStart != null ? String(s.quietHoursStart) : "");
    setQuietEnd(s.quietHoursEnd != null ? String(s.quietHoursEnd) : "");
  }, [s]);

  const reload = () => {
    setErr(null);
    setOkNote(null);
    detail.reload();
  };

  const saveSettings = async (patch?: Partial<{
    enabled: boolean;
    mode: string;
    allowComment: boolean;
    maxActionsPerDay: number;
  }>) => {
    if (!canOversee) return;
    setBusy(true);
    setErr(null);
    setOkNote(null);
    try {
      await api.post(`/admin/agents/${encodeURIComponent(userId)}/settings`, {
        enabled: patch?.enabled ?? enabled,
        mode: patch?.mode ?? mode,
        allowComment: patch?.allowComment ?? allowComment,
        allowReply: false,
        allowReact: false,
        allowPost: false,
        maxActionsPerDay: patch?.maxActionsPerDay ?? maxPerDay,
        styleNotes: styleNotes || null,
        topicsAvoid: topicsAvoid || null,
        quietHoursStart: quietStart === "" ? null : Number(quietStart),
        quietHoursEnd: quietEnd === "" ? null : Number(quietEnd),
      });
      setOkNote("Settings saved.");
      reload();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const addPhrase = async () => {
    if (!canOversee || !phraseText.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/admin/agents/${encodeURIComponent(userId)}/phrases`, {
        kind: phraseKind,
        text: phraseText.trim(),
      });
      setPhraseText("");
      reload();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const deletePhrase = async (phraseId: string) => {
    if (!canOversee) return;
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/admin/agents/phrases/${encodeURIComponent(phraseId)}/delete`, {});
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
      setOkNote(out?.note || (decision === "approve" ? "Approved." : "Rejected."));
      reload();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const phrases = detail.data?.phrases ?? [];
  const proposals = detail.data?.proposals ?? [];
  const log = detail.data?.log ?? [];
  const global = detail.data?.global;

  return (
    <div>
      <PageHeader
        title="Agent settings"
        subtitle={userId}
        actions={
          <div className="row" style={{ gap: 8 }}>
            <Link to="/agents" className="btn ghost tiny">← All agents</Link>
            <Link to={`/people/${encodeURIComponent(userId)}`} className="btn ghost tiny">Person</Link>
            <button className="btn ghost tiny" onClick={reload} disabled={busy}>Refresh</button>
          </div>
        }
      />

      <InfoNote>
        Posting stays hard-off. Comments: <code>suggest_only</code> needs approve;
        <code> auto_with_limits</code> can auto-send only when global force suggest_only is off, under daily/hourly caps.
        Mel/admin can manage settings; coin credit is on People → person → Wallet.
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

      {detail.loading && <Spinner />}
      {detail.error && <ErrorNote>{detail.error}</ErrorNote>}

      {s && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12, marginTop: 14 }}>
            <div className="card stack">
              <h3 className="panel-title">Quick controls</h3>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <Badge kind={s.enabled ? "ok" : "warn"}>{s.enabled ? "enabled" : "paused"}</Badge>
                <Badge kind="info">{s.mode}</Badge>
                <Badge kind="info">post={String(s.allowPost)}</Badge>
              </div>
              {global && (
                <div className="dim" style={{ fontSize: 12 }}>
                  Global: {global.paused ? "PAUSED" : "RUNNING"} · forceSuggestOnly={String(global.forceSuggestOnly)}
                </div>
              )}
              {canOversee ? (
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <button
                    className="btn tiny"
                    disabled={busy}
                    onClick={() => saveSettings({ enabled: !s.enabled })}
                  >
                    {s.enabled ? "Force pause agent" : "Enable agent"}
                  </button>
                  <button
                    className="btn ghost tiny"
                    disabled={busy}
                    onClick={() => {
                      setMode("suggest_only");
                      void saveSettings({ mode: "suggest_only" });
                    }}
                  >
                    Force suggest_only
                  </button>
                </div>
              ) : (
                <WarnNote>Need <code>agents.oversight</code> to mutate (Owner + Mel/admin).</WarnNote>
              )}
            </div>

            <div className="card stack">
              <h3 className="panel-title">Queue</h3>
              <Badge kind={(detail.data?.pendingCount || 0) > 0 ? "warn" : "ok"}>
                {detail.data?.pendingCount || 0} pending
              </Badge>
              <p className="dim" style={{ fontSize: 12.5, margin: 0 }}>
                Approve sends the comment when a real post target exists.
              </p>
            </div>
          </div>

          <div className="card stack" style={{ marginTop: 14 }}>
            <h3 className="panel-title">Settings</h3>
            <label>Mode</label>
            <select
              value={mode}
              disabled={!canOversee || busy}
              onChange={(e) => setMode(e.target.value)}
            >
              <option value="off">off</option>
              <option value="suggest_only">suggest_only (approve required)</option>
              <option value="auto_with_limits">auto_with_limits (comments only, rate-capped)</option>
            </select>
            <label className="row" style={{ gap: 8, marginTop: 8 }}>
              <input
                type="checkbox"
                checked={enabled}
                disabled={!canOversee || busy}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              Enabled
            </label>
            <label className="row" style={{ gap: 8 }}>
              <input
                type="checkbox"
                checked={allowComment}
                disabled={!canOversee || busy}
                onChange={(e) => setAllowComment(e.target.checked)}
              />
              Allow auto-comment proposals
            </label>
            <label>Max actions / day</label>
            <input
              type="number"
              min={1}
              max={50}
              value={maxPerDay}
              disabled={!canOversee || busy}
              onChange={(e) => setMaxPerDay(Number(e.target.value) || 5)}
            />
            <label>Style notes</label>
            <input
              value={styleNotes}
              disabled={!canOversee || busy}
              onChange={(e) => setStyleNotes(e.target.value)}
              placeholder="Friendly, short, no slang…"
            />
            <label>Topics to avoid (comma-separated)</label>
            <input
              value={topicsAvoid}
              disabled={!canOversee || busy}
              onChange={(e) => setTopicsAvoid(e.target.value)}
              placeholder="politics, crypto…"
            />
            <div className="row" style={{ gap: 12 }}>
              <div className="grow">
                <label>Quiet hours start (UTC hour)</label>
                <input
                  value={quietStart}
                  disabled={!canOversee || busy}
                  onChange={(e) => setQuietStart(e.target.value)}
                  placeholder="e.g. 22"
                />
              </div>
              <div className="grow">
                <label>Quiet hours end (UTC hour)</label>
                <input
                  value={quietEnd}
                  disabled={!canOversee || busy}
                  onChange={(e) => setQuietEnd(e.target.value)}
                  placeholder="e.g. 7"
                />
              </div>
            </div>
            <p className="dim" style={{ fontSize: 12 }}>
              Auto-post is hard-disabled. Reply/react remain off in this console for now.
            </p>
            {canOversee && (
              <button className="btn" disabled={busy} onClick={() => saveSettings()}>
                Save settings
              </button>
            )}
          </div>

          <div className="card stack" style={{ marginTop: 14 }}>
            <h3 className="panel-title">Phrase bank</h3>
            <div className="stack" style={{ gap: 8 }}>
              {phrases.length === 0 && <p className="dim" style={{ margin: 0 }}>No custom phrases — worker uses defaults.</p>}
              {phrases.map((p) => (
                <div key={p.phraseId} className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                  <div>
                    <Badge kind={p.kind === "deny" ? "warn" : "ok"}>{p.kind}</Badge>{" "}
                    <span style={{ fontSize: 13 }}>{p.text}</span>
                  </div>
                  {canOversee && (
                    <button className="btn ghost tiny" disabled={busy} onClick={() => deletePhrase(p.phraseId)}>
                      Delete
                    </button>
                  )}
                </div>
              ))}
            </div>
            {canOversee && (
              <div className="stack" style={{ marginTop: 10, gap: 8 }}>
                <div className="row" style={{ gap: 8 }}>
                  <select
                    value={phraseKind}
                    onChange={(e) => setPhraseKind(e.target.value as "allow" | "deny")}
                    style={{ maxWidth: 120 }}
                  >
                    <option value="allow">allow</option>
                    <option value="deny">deny</option>
                  </select>
                  <input
                    className="grow"
                    value={phraseText}
                    onChange={(e) => setPhraseText(e.target.value)}
                    placeholder="Phrase text…"
                  />
                  <button className="btn tiny" disabled={busy || !phraseText.trim()} onClick={addPhrase}>
                    Add
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="card stack" style={{ marginTop: 14 }}>
            <h3 className="panel-title">Proposals</h3>
            {proposals.length === 0 && <p className="dim" style={{ margin: 0 }}>None yet.</p>}
            {proposals.map((p) => (
              <div key={p.proposalId} style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <div>
                    <Badge kind="info">{p.actionType}</Badge>{" "}
                    <Badge kind={p.status === "pending" ? "warn" : p.status === "executed" ? "ok" : "neutral"}>
                      {p.status}
                    </Badge>
                    <span className="dim" style={{ fontSize: 11, marginLeft: 8 }}>
                      {fmtRelative(p.createdAt)}
                    </span>
                  </div>
                  {canOversee && p.status === "pending" && (
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
                  {p.targetId ? ` · target ${p.targetId}` : ""}
                  {p.executedAt ? ` · executed ${fmtRelative(p.executedAt)}` : ""}
                </div>
              </div>
            ))}
          </div>

          <div className="card stack" style={{ marginTop: 14 }}>
            <h3 className="panel-title">Activity log</h3>
            {log.length === 0 && <p className="dim" style={{ margin: 0 }}>No events.</p>}
            {log.map((row) => (
              <div key={row.logId} className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <div style={{ fontSize: 13 }}>
                  <Badge kind="info">{row.outcome}</Badge> {row.actionType}
                  {row.detail ? ` — ${row.detail}` : ""}
                </div>
                <span className="dim" style={{ fontSize: 11 }}>{fmtRelative(row.createdAt)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
