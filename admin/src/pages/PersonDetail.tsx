import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { useAsync } from "../lib/useAsync";
import { fmtDate, fmtRelative } from "../lib/format";
import AdminUserAvatar from "../components/AdminUserAvatar";
import { PageHeader, Spinner, ErrorNote, Badge, EmptyState } from "../components/ui";
import type { AdminUserDetail, AdminPostsResponse } from "../types";

type Tab = "overview" | "controls" | "posts" | "activity";

export default function PersonDetail() {
  const { userId = "" } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("overview");

  const detail = useAsync<AdminUserDetail>(() => api.get<AdminUserDetail>(`/admin/users/${encodeURIComponent(userId)}`), [userId]);
  const u = detail.data;

  return (
    <div>
      <PageHeader
        title={u?.displayName || u?.username || "User"}
        subtitle={userId}
        actions={<button className="btn ghost tiny" onClick={() => navigate("/people")}>← All people</button>}
      />

      {detail.loading && <Spinner label="Loading profile…" />}
      {detail.error && <ErrorNote>{detail.error}</ErrorNote>}

      {u && (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="row" style={{ gap: 16 }}>
              <AdminUserAvatar
                photoURL={u.photoURL}
                displayName={u.displayName}
                username={u.username}
                userId={u.userId}
                size={56}
                borderRadius={16}
                avatarFrame={u.avatarFrame}
              />
              <div className="grow">
                <div className="row" style={{ gap: 10 }}>
                  <span style={{ fontSize: 18, fontWeight: 800 }}>{u.displayName || u.username || "—"}</span>
                  {u.verification.isVerified && <Badge kind="info">Verified</Badge>}
                  {u.isBanned ? <Badge kind="err">Banned</Badge> : u.enabled === false ? <Badge kind="warn">Disabled</Badge> : <Badge kind="ok">Active</Badge>}
                </div>
                <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                  {u.username ? `@${u.username} · ` : ""}{u.email || "no email"}{u.phoneNumber ? ` · ${u.phoneNumber}` : ""}
                </div>
              </div>
            </div>
          </div>

          <div className="row" style={{ gap: 6, marginBottom: 16 }}>
            {(["overview", "controls", "posts", "activity"] as Tab[]).map((t) => (
              <button
                key={t}
                className={tab === t ? "btn tiny" : "btn ghost tiny"}
                onClick={() => setTab(t)}
                style={{ textTransform: "capitalize" }}
              >
                {t}
              </button>
            ))}
          </div>

          {tab === "overview" && <Overview u={u} />}
          {tab === "controls" && <Controls key={`${u.userId}:${u.avatarFrame || ""}`} u={u} reload={detail.reload} />}
          {tab === "posts" && <Posts userId={userId} />}
          {tab === "activity" && <Activity u={u} />}
        </>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div className="dim" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontSize: 14, marginTop: 2 }}>{value || <span className="dim">—</span>}</div>
    </div>
  );
}

function Overview({ u }: { u: AdminUserDetail }) {
  const location = [u.address, u.city, u.region, u.postcode, u.country].filter(Boolean).join(", ");
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      <div className="card">
        <h3 className="panel-title">Identity</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Field label="User ID" value={u.userId} />
          <Field label="Username" value={u.username} />
          <Field label="Display name" value={u.displayName} />
          <Field label="Email" value={u.email} />
          <Field label="Phone" value={u.phoneNumber} />
          <Field label="Date of birth" value={u.dateOfBirth} />
          <Field label="Cognito status" value={u.userStatus} />
          <Field label="Role" value={u.role} />
        </div>
      </div>
      <div className="card">
        <h3 className="panel-title">Account</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Field label="Location" value={location} />
          <Field label="Enabled" value={u.enabled === false ? "No" : "Yes"} />
          <Field label="Banned" value={u.isBanned ? `Yes${u.bannedUntil ? ` (until ${fmtDate(u.bannedUntil)})` : ""}` : "No"} />
          <Field label="Ban reason" value={u.banReason} />
          <Field label="Joined" value={fmtDate(u.createdAt)} />
          <Field label="Updated" value={fmtDate(u.updatedAt)} />
        </div>
      </div>
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="row" style={{ gap: 8, cursor: "pointer", margin: 0 }}>
      <input type="checkbox" style={{ width: 16, height: 16 }} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span style={{ fontSize: 13, color: "var(--text)" }}>{label}</span>
    </label>
  );
}

function Controls({ u, reload }: { u: AdminUserDetail; reload: () => void }) {
  const [verified, setVerified] = useState(u.verification.isVerified);
  const [verificationNote, setVerificationNote] = useState(u.verification.note || "");
  const [role, setRole] = useState(u.role || "user");
  const [avatarFrame, setAvatarFrame] = useState<string>(u.avatarFrame || "");
  const [messagingRestricted, setMessaging] = useState(u.restrictions.messagingRestricted);
  const [liveRestricted, setLive] = useState(u.restrictions.liveRestricted);
  const [loginRestricted, setLogin] = useState(u.restrictions.loginRestricted);
  const [accountRestricted, setAccount] = useState(u.restrictions.accountRestricted);
  const [reason, setReason] = useState(u.restrictions.reason || "");

  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [banReason, setBanReason] = useState("");
  const [msgSubject, setMsgSubject] = useState("");
  const [msgBody, setMsgBody] = useState("");

  async function run(key: string, fn: () => Promise<unknown>, okMsg: string) {
    setBusy(key); setErr(null); setMsg(null);
    try {
      await fn();
      setMsg(okMsg);
      reload();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack">
      {msg && <div style={{ color: "var(--success)", fontSize: 13 }}>{msg}</div>}
      {err && <ErrorNote>{err}</ErrorNote>}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div className="card stack">
          <h3 className="panel-title">Capabilities & restrictions</h3>
          <Toggle checked={verified} onChange={setVerified} label="Verified badge" />
          <div>
            <label>Verification note</label>
            <input value={verificationNote} onChange={(e) => setVerificationNote(e.target.value)} placeholder="Optional note" />
          </div>
          <div>
            <label>Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="user">user</option>
              <option value="manager">manager</option>
              <option value="admin">admin</option>
            </select>
          </div>
          <div>
            <label>Avatar frame</label>
            <div className="row" style={{ gap: 12, alignItems: "center", marginTop: 6 }}>
              <AdminUserAvatar
                photoURL={u.photoURL}
                displayName={u.displayName}
                username={u.username}
                userId={u.userId}
                size={52}
                avatarFrame={avatarFrame || null}
              />
              <select value={avatarFrame} onChange={(e) => setAvatarFrame(e.target.value)} style={{ flex: 1 }}>
                <option value="">None</option>
                <option value="gold_crown">Gold crown ring</option>
              </select>
            </div>
            <div className="dim" style={{ fontSize: 11, marginTop: 6 }}>
              Shown as a gold circle with a crown on their avatar across the app.
            </div>
          </div>
          <div className="stack" style={{ gap: 8, marginTop: 4 }}>
            <Toggle checked={messagingRestricted} onChange={setMessaging} label="Restrict messaging" />
            <Toggle checked={liveRestricted} onChange={setLive} label="Restrict going live" />
            <Toggle checked={loginRestricted} onChange={setLogin} label="Restrict login" />
            <Toggle checked={accountRestricted} onChange={setAccount} label="Restrict account (full)" />
          </div>
          <div>
            <label>Restriction reason</label>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Shown context for the restriction" />
          </div>
          <button
            className="btn"
            disabled={busy === "caps"}
            onClick={() =>
              run("caps", async () => {
                const res = await api.post<{ detail?: { avatarFrame?: string | null }; ok?: boolean }>(
                  `/admin/users/${encodeURIComponent(u.userId)}/capabilities`,
                  {
                    verified, role, verificationNote,
                    messagingRestricted, liveRestricted, loginRestricted, accountRestricted, reason,
                    avatarFrame: avatarFrame || null,
                  },
                );
                const saved = res?.detail?.avatarFrame ?? (avatarFrame || null);
                setAvatarFrame(saved || "");
              }, "Capabilities saved.")
            }
          >
            {busy === "caps" ? "Saving…" : "Save capabilities"}
          </button>
        </div>

        <div className="stack">
          <div className="card stack">
            <h3 className="panel-title">Enforcement</h3>
            {u.isBanned ? (
              <>
                <div className="muted" style={{ fontSize: 13 }}>This user is currently banned{u.banReason ? `: ${u.banReason}` : ""}.</div>
                <button className="btn success" disabled={busy === "ban"} onClick={() => run("ban", () => api.post(`/admin/users/${encodeURIComponent(u.userId)}/unban`, { reason: banReason || null }), "User unbanned.")}>
                  {busy === "ban" ? "Working…" : "Unban user"}
                </button>
              </>
            ) : (
              <>
                <div>
                  <label>Ban reason</label>
                  <input value={banReason} onChange={(e) => setBanReason(e.target.value)} placeholder="Reason (recorded in audit log)" />
                </div>
                <button className="btn danger" disabled={busy === "ban"} onClick={() => run("ban", () => api.post(`/admin/users/${encodeURIComponent(u.userId)}/ban`, { reason: banReason || null, bannedUntil: null }), "User banned.")}>
                  {busy === "ban" ? "Working…" : "Ban user"}
                </button>
              </>
            )}
          </div>

          <div className="card stack">
            <h3 className="panel-title">Send message</h3>
            <div>
              <label>Subject</label>
              <input value={msgSubject} onChange={(e) => setMsgSubject(e.target.value)} placeholder="Optional subject" />
            </div>
            <div>
              <label>Message</label>
              <textarea rows={3} value={msgBody} onChange={(e) => setMsgBody(e.target.value)} placeholder="In-app message to the user" />
            </div>
            <button
              className="btn"
              disabled={busy === "msg" || !msgBody.trim()}
              onClick={() =>
                run("msg", async () => {
                  await api.post(`/admin/users/${encodeURIComponent(u.userId)}/message`, { channel: "in_app", subject: msgSubject || null, message: msgBody });
                  setMsgBody(""); setMsgSubject("");
                }, "Message queued.")
              }
            >
              {busy === "msg" ? "Sending…" : "Queue message"}
            </button>
          </div>
        </div>
      </div>

      <Wallet u={u} reload={reload} />
    </div>
  );
}

function Wallet({ u, reload }: { u: AdminUserDetail; reload: () => void }) {
  const [coins, setCoins] = useState("");
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const amount = Math.floor(Number(coins));
  const validAmount = Number.isFinite(amount) && amount >= 1 && amount <= 1_000_000;

  async function submit() {
    if (!validAmount) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      const idempotencyKey =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `admin-dash-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const res = await api.post<{ coinsCredited: number; newBalance: number }>(
        `/admin/users/${encodeURIComponent(u.userId)}/credit-coins`,
        { coins: amount, reason: reason || undefined, idempotencyKey }
      );
      setMsg(`Credited ${res.coinsCredited.toLocaleString()} coins. New balance: ${res.newBalance.toLocaleString()}.`);
      setCoins(""); setReason(""); setConfirming(false);
      reload();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card stack">
      <h3 className="panel-title">Wallet · add coins</h3>
      {msg && <div style={{ color: "var(--success)", fontSize: 13 }}>{msg}</div>}
      {err && <ErrorNote>{err}</ErrorNote>}
      <div className="row" style={{ gap: 12 }}>
        <div className="grow">
          <label>Coins to add</label>
          <input
            type="number" min={1} max={1000000} value={coins}
            onChange={(e) => { setCoins(e.target.value); setConfirming(false); }}
            placeholder="e.g. 500"
          />
        </div>
        <div className="grow">
          <label>Reason (optional)</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Recorded in audit log" />
        </div>
      </div>

      {!confirming ? (
        <button className="btn" disabled={!validAmount} onClick={() => { setErr(null); setMsg(null); setConfirming(true); }}>
          Add coins
        </button>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          <div className="muted" style={{ fontSize: 13 }}>
            Confirm crediting <strong>{amount.toLocaleString()}</strong> coins to {u.displayName || u.username || u.userId}.
            This posts an audited ledger entry via your Cognito admin session.
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn" disabled={busy} onClick={submit}>
              {busy ? "Crediting…" : "Confirm & add coins"}
            </button>
            <button className="btn ghost" disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Posts({ userId }: { userId: string }) {
  const res = useAsync<AdminPostsResponse>(() => api.get<AdminPostsResponse>(`/admin/users/${encodeURIComponent(userId)}/posts?limit=50&offset=0`), [userId]);
  const [busy, setBusy] = useState<string | null>(null);

  async function moderate(postId: string, remove: boolean) {
    setBusy(postId);
    try {
      await api.post(`/admin/posts/${encodeURIComponent(postId)}/${remove ? "remove" : "restore"}`, { userId, reason: null });
      res.reload();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card">
      <h3 className="panel-title">Posts</h3>
      {res.loading && <Spinner />}
      {res.error && <ErrorNote>{res.error}</ErrorNote>}
      {res.data?.degraded && <ErrorNote>{res.data.detail}</ErrorNote>}
      {res.data && !res.loading && (
        res.data.items.length === 0 ? (
          <EmptyState>No posts found for this user{res.data.sourceTable ? ` in ${res.data.sourceTable}` : ""}.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Content</th><th>Type</th><th>Engagement</th><th>Created</th><th>State</th><th></th></tr></thead>
              <tbody>
                {res.data.items.map((p) => (
                  <tr key={p.postId}>
                    <td style={{ maxWidth: 320 }}>
                      <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.content || <span className="dim">no text</span>}</div>
                      {p.thumbnailUrl && <a href={p.thumbnailUrl} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: 11 }}>media ↗</a>}
                    </td>
                    <td><span className="dim">{p.postType}</span></td>
                    <td className="muted" style={{ fontSize: 11, whiteSpace: "nowrap" }}>♥ {p.likes.toLocaleString()} · 👁 {p.views.toLocaleString()} · 💬 {p.comments.toLocaleString()}</td>
                    <td className="muted" style={{ fontSize: 12 }}>{fmtRelative(p.createdAt)}</td>
                    <td>{p.isRemoved ? <Badge kind="err">Removed</Badge> : <Badge kind="ok">Live</Badge>}</td>
                    <td style={{ textAlign: "right" }}>
                      <button className={p.isRemoved ? "btn success tiny" : "btn danger tiny"} disabled={busy === p.postId} onClick={() => moderate(p.postId, !p.isRemoved)}>
                        {p.isRemoved ? "Restore" : "Remove"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}

function Activity({ u }: { u: AdminUserDetail }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      <div className="card">
        <h3 className="panel-title">Admin actions</h3>
        {u.recentActions.length === 0 ? <EmptyState>No admin actions recorded.</EmptyState> : (
          <div className="stack" style={{ gap: 10 }}>
            {u.recentActions.map((a, i) => (
              <div key={i} className="row spread" style={{ borderBottom: "1px solid var(--divider)", paddingBottom: 8 }}>
                <span style={{ fontSize: 13 }}>{a.action}</span>
                <span className="dim" style={{ fontSize: 11 }}>{fmtRelative(a.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="card">
        <h3 className="panel-title">Messages</h3>
        {u.recentMessages.length === 0 ? <EmptyState>No messages sent.</EmptyState> : (
          <div className="stack" style={{ gap: 10 }}>
            {u.recentMessages.map((m) => (
              <div key={m.messageId} style={{ borderBottom: "1px solid var(--divider)", paddingBottom: 8 }}>
                <div className="row spread">
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{m.subject || "(no subject)"}</span>
                  <Badge kind="neutral">{m.status}</Badge>
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{m.body}</div>
                <div className="dim" style={{ fontSize: 11, marginTop: 2 }}>{fmtRelative(m.createdAt)} · {m.channel}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
