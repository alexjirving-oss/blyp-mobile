import { useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/useAuth";
import { useAsync } from "../lib/useAsync";
import { fmtRelative } from "../lib/format";
import { PageHeader, Spinner, ErrorNote, Badge, EmptyState, InfoNote } from "../components/ui";
import type { MessagesResponse } from "../types";

type Segment = "all" | "active" | "banned";

export default function Comms() {
  const { can } = useAuth();
  const canBroadcast = can("comms.broadcast");
  const canAll = can("comms.broadcast.all");
  const [segment, setSegment] = useState<Segment>(canAll ? "all" : "active");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [deepLink, setDeepLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const recent = useAsync<MessagesResponse>(() => api.get<MessagesResponse>("/admin/comms/messages?limit=50"), []);

  async function send() {
    if (!canBroadcast) {
      setErr("Missing comms.broadcast permission");
      return;
    }
    if (segment === "all" && !canAll) {
      setErr("All-user blast requires comms.broadcast.all (Owner/Exec)");
      return;
    }
    if (!message.trim()) return;
    if (!window.confirm(`Broadcast to segment “${segment}”? This delivers to in-app inboxes and is audited.`)) return;
    setBusy(true); setErr(null); setNote(null);
    try {
      const out = await api.post<{ queued: number; delivered?: number }>("/admin/comms/broadcast", {
        segment,
        subject: subject || null,
        message,
        deepLink: deepLink.trim() || null,
      });
      const delivered = typeof out.delivered === "number" ? out.delivered : out.queued;
      setNote(
        `Delivered to ${delivered} in-app inbox${delivered === 1 ? "" : "es"}` +
          (out.queued !== delivered ? ` (${out.queued} queued in audit log)` : "") +
          " (audited)."
      );
      setSubject(""); setMessage(""); setDeepLink("");
      recent.reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title="Comms" subtitle="Broadcast and targeted messaging into the in-app inbox" />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 16 }}>
        <div className="card stack">
          <h3 className="panel-title">New broadcast</h3>
          <div>
            <label>Audience</label>
            <div className="row" style={{ gap: 6 }}>
              {(["all", "active", "banned"] as Segment[]).map((s) => (
                <button
                  key={s}
                  className={segment === s ? "btn tiny" : "btn ghost tiny"}
                  disabled={s === "all" && !canAll}
                  title={s === "all" && !canAll ? "Owner/Exec only" : undefined}
                  onClick={() => setSegment(s)}
                  style={{ textTransform: "capitalize" }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label>Quick templates</label>
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              {[
                { s: "Service update", m: "We're making improvements to Blyp. Thanks for your patience." },
                { s: "Policy reminder", m: "Please review our community guidelines. Violations may result in restrictions." },
                { s: "Incident notice", m: "We are investigating a platform issue and will update you shortly." },
              ].map((t) => (
                <button
                  key={t.s}
                  type="button"
                  className="btn ghost tiny"
                  onClick={() => {
                    setSubject(t.s);
                    setMessage(t.m);
                  }}
                >
                  {t.s}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label>Subject</label>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Optional subject" />
          </div>
          <div>
            <label>Message</label>
            <textarea rows={5} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Your announcement to the selected audience…" />
          </div>
          <div>
            <label>Deep link (optional)</label>
            <input
              value={deepLink}
              onChange={(e) => setDeepLink(e.target.value)}
              placeholder="https://… or leave blank"
            />
          </div>
          {note && <div style={{ color: "var(--success)", fontSize: 13 }}>{note}</div>}
          {err && <ErrorNote>{err}</ErrorNote>}
          <button className="btn" disabled={busy || !message.trim() || !canBroadcast} title={!canBroadcast ? "Missing permission" : undefined} onClick={send}>
            {busy ? "Sending…" : `Send to ${segment}`}
          </button>
          {!canBroadcast && <InfoNote>Broadcast disabled for your role.</InfoNote>}
          <div className="dim" style={{ fontSize: 11 }}>
            Messages are delivered to each user's in-app inbox (Messages → Notifications). Push is optional when a device is registered.
          </div>
        </div>

        <div className="card">
          <div className="row spread" style={{ marginBottom: 8 }}>
            <h3 className="panel-title" style={{ margin: 0 }}>Recent messages</h3>
            <button className="btn ghost tiny" onClick={() => recent.reload()}>Refresh</button>
          </div>
          {recent.loading && <Spinner />}
          {recent.error && <ErrorNote>{recent.error}</ErrorNote>}
          {recent.data && (
            recent.data.items.length === 0 ? <EmptyState>No messages sent yet.</EmptyState> : (
              <div className="table-wrap" style={{ maxHeight: 460 }}>
                <table>
                  <thead><tr><th>Subject / body</th><th>To</th><th>Type</th><th>When</th></tr></thead>
                  <tbody>
                    {recent.data.items.map((m) => (
                      <tr key={m.messageId}>
                        <td style={{ maxWidth: 280 }}>
                          <div style={{ fontWeight: 600, fontSize: 12 }}>{m.subject || "(no subject)"}</div>
                          <div className="dim" style={{ fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.body}</div>
                        </td>
                        <td className="mono" style={{ fontSize: 11 }}>{m.userId.slice(0, 12)}</td>
                        <td>{m.broadcast ? <Badge kind="info">Broadcast</Badge> : <Badge kind="neutral">Direct</Badge>}</td>
                        <td className="muted" style={{ fontSize: 11 }}>{fmtRelative(m.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
