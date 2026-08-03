import { useState } from "react";
import { api } from "../api/client";
import { useAsync } from "../lib/useAsync";
import { fmtRelative } from "../lib/format";
import { PageHeader, Spinner, ErrorNote, Badge, EmptyState } from "../components/ui";
import type { MessagesResponse } from "../types";

type Segment = "all" | "active" | "banned";

export default function Comms() {
  const [segment, setSegment] = useState<Segment>("all");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const recent = useAsync<MessagesResponse>(() => api.get<MessagesResponse>("/admin/comms/messages?limit=50"), []);

  async function send() {
    if (!message.trim()) return;
    setBusy(true); setErr(null); setNote(null);
    try {
      const out = await api.post<{ queued: number }>("/admin/comms/broadcast", { segment, subject: subject || null, message });
      setNote(`Queued to ${out.queued} user${out.queued === 1 ? "" : "s"}.`);
      setSubject(""); setMessage("");
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
                <button key={s} className={segment === s ? "btn tiny" : "btn ghost tiny"} onClick={() => setSegment(s)} style={{ textTransform: "capitalize" }}>{s}</button>
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
          {note && <div style={{ color: "var(--success)", fontSize: 13 }}>{note}</div>}
          {err && <ErrorNote>{err}</ErrorNote>}
          <button className="btn" disabled={busy || !message.trim()} onClick={send}>
            {busy ? "Sending…" : `Send to ${segment}`}
          </button>
          <div className="dim" style={{ fontSize: 11 }}>
            Messages are queued into each user's in-app inbox. Delivery rendering inside the app is the next app-side step.
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
