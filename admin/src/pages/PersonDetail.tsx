import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/useAuth";
import { useAsync } from "../lib/useAsync";
import { fmtDate, fmtNum, fmtRelative } from "../lib/format";
import AdminUserAvatar from "../components/AdminUserAvatar";
import { PageHeader, Spinner, ErrorNote, Badge, EmptyState, InfoNote, WarnNote } from "../components/ui";
import type {
  AdminUserDetail,
  AdminPostsResponse,
  WalletResponse,
  LedgerResponse,
  StrikeSummary,
} from "../types";

type Tab = "overview" | "controls" | "360" | "posts" | "activity";

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
            {(["overview", "360", "controls", "posts", "activity"] as Tab[]).map((t) => (
              <button
                key={t}
                className={tab === t ? "btn tiny" : "btn ghost tiny"}
                onClick={() => setTab(t)}
                style={{ textTransform: "capitalize" }}
              >
                {t === "360" ? "User 360" : t}
              </button>
            ))}
          </div>

          {tab === "overview" && <Overview u={u} />}
          {tab === "360" && <User360 userId={userId} u={u} />}
          {tab === "controls" && (
            <Controls
              key={`${u.userId}:${u.avatarFrame || ""}:${u.feedPriorityAccount || "standard"}`}
              u={u}
              reload={detail.reload}
            />
          )}
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
          <Field label="Feed priority" value={u.feedPriorityAccount || "standard"} />
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

function User360({ userId, u }: { userId: string; u: AdminUserDetail }) {
  const wallet = useAsync<WalletResponse>(() => api.get<WalletResponse>(`/admin/users/${encodeURIComponent(userId)}/wallet`), [userId]);
  const ledger = useAsync<LedgerResponse>(() => api.get<LedgerResponse>(`/admin/users/${encodeURIComponent(userId)}/ledger?limit=25`), [userId]);
  const reports = useAsync<{ available: boolean; reports: Array<{ reportId: string; reasonCode: string; status: string; reporterId: string; targetId: string; createdAt: string | null }>; note?: string }>(
    () => api.get(`/admin/users/${encodeURIComponent(userId)}/reports`),
    [userId],
  );
  const devices = useAsync<{ available: boolean; items: unknown[]; note?: string; detail?: string }>(
    () => api.get(`/admin/users/${encodeURIComponent(userId)}/devices`),
    [userId],
  );
  const strikes = useAsync<StrikeSummary>(() => api.get<StrikeSummary>(`/admin/users/${encodeURIComponent(userId)}/strikes`), [userId]);
  const [strikeReason, setStrikeReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function addStrike() {
    if (!strikeReason.trim()) return;
    setBusy(true);
    try {
      await api.post(`/admin/users/${encodeURIComponent(userId)}/strikes`, { reason: strikeReason.trim() });
      setStrikeReason("");
      strikes.reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 }}>
        <div className="card">
          <div className="dim" style={{ fontSize: 11 }}>Coins</div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{wallet.data?.available ? fmtNum(wallet.data.coinBalance || 0) : "—"}</div>
        </div>
        <div className="card">
          <div className="dim" style={{ fontSize: 11 }}>Bonus coins</div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{wallet.data?.available ? fmtNum(wallet.data.bonusCoinBalance || 0) : "—"}</div>
        </div>
        <div className="card">
          <div className="dim" style={{ fontSize: 11 }}>Gems avail / pending</div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>
            {wallet.data?.available ? `${fmtNum(wallet.data.gemAvailable || 0)} / ${fmtNum(wallet.data.gemPending || 0)}` : "—"}
          </div>
        </div>
        <div className="card">
          <div className="dim" style={{ fontSize: 11 }}>Active strikes</div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{strikes.data?.activeCount ?? "—"}</div>
        </div>
      </div>
      {wallet.data && !wallet.data.available && <WarnNote>Wallet unavailable: {wallet.data.detail}</WarnNote>}

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 16 }}>
        <div className="card">
          <div className="row spread" style={{ marginBottom: 8 }}>
            <h3 className="panel-title" style={{ margin: 0 }}>Recent ledger</h3>
            <Link className="btn ghost tiny" to="/economy">Open explorer</Link>
          </div>
          {ledger.loading && <Spinner />}
          {ledger.data && ledger.data.items.length === 0 && <EmptyState>No ledger entries.</EmptyState>}
          {ledger.data && ledger.data.items.length > 0 && (
            <div className="table-wrap" style={{ maxHeight: 320 }}>
              <table>
                <thead><tr><th>When</th><th>Type</th><th>Amount</th></tr></thead>
                <tbody>
                  {ledger.data.items.map((e) => (
                    <tr key={e.ledgerId}>
                      <td className="muted" style={{ fontSize: 11 }}>{fmtRelative(e.createdAt)}</td>
                      <td style={{ fontSize: 12 }}>{e.entryType}</td>
                      <td>{fmtNum(e.amount)} <span className="dim">{e.currency}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card stack">
          <h3 className="panel-title">Reports (recent window)</h3>
          {reports.data?.note && <InfoNote>{reports.data.note}</InfoNote>}
          {reports.data && reports.data.reports.length === 0 && <EmptyState>No reports in recent window.</EmptyState>}
          {reports.data?.reports.map((r) => (
            <div key={r.reportId} className="row spread" style={{ borderBottom: "1px solid var(--divider)", paddingBottom: 6 }}>
              <div>
                <Badge kind={r.status === "open" ? "warn" : "neutral"}>{r.reasonCode || "report"}</Badge>
                <div className="dim" style={{ fontSize: 11, marginTop: 4 }}>
                  {r.targetId === userId ? "as target" : "as reporter"} · {fmtRelative(r.createdAt)}
                </div>
              </div>
              <Link className="btn ghost tiny" to={`/safety?q=${encodeURIComponent(r.reportId)}`}>Safety</Link>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div className="card">
          <h3 className="panel-title">Devices / sessions</h3>
          {devices.data && !devices.data.available && (
            <WarnNote>{devices.data.note || devices.data.detail || "Unavailable"}</WarnNote>
          )}
          <EmptyState>No device inventory in live-service (honest empty).</EmptyState>
        </div>
        <div className="card stack">
          <h3 className="panel-title">Strikes</h3>
          <div className="row" style={{ gap: 8 }}>
            <input className="grow" value={strikeReason} onChange={(e) => setStrikeReason(e.target.value)} placeholder="Strike reason (audited)" />
            <button className="btn tiny" disabled={busy || !strikeReason.trim()} onClick={addStrike}>
              {busy ? "…" : "Add strike"}
            </button>
          </div>
          {strikes.data?.strikes.length === 0 && <EmptyState>No strikes.</EmptyState>}
          {strikes.data?.strikes.map((s) => (
            <div key={s.strikeId} className="row spread" style={{ borderBottom: "1px solid var(--divider)", paddingBottom: 6 }}>
              <div>
                <span style={{ fontSize: 13 }}>{s.reason}</span>
                <div className="dim" style={{ fontSize: 11 }}>{fmtRelative(s.createdAt)}</div>
              </div>
              <Badge kind={s.active ? "err" : "neutral"}>{s.active ? "active" : "inactive"}</Badge>
            </div>
          ))}
          <div className="dim" style={{ fontSize: 11 }}>
            Caps timeline: messaging {u.restrictions.messagingRestricted ? "restricted" : "ok"} · live{" "}
            {u.restrictions.liveRestricted ? "restricted" : "ok"} · login{" "}
            {u.restrictions.loginRestricted ? "restricted" : "ok"}
          </div>
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
  const { can } = useAuth();
  const canCaps = can("users.capabilities");
  const canFeed = can("growth.feed_priority");
  const canBan = can("users.ban");
  const canUnban = can("users.unban");
  const canMsg = can("users.message");
  const [verified, setVerified] = useState(u.verification.isVerified);
  const [verificationNote, setVerificationNote] = useState(u.verification.note || "");
  const [role, setRole] = useState(u.role || "user");
  const [avatarFrame, setAvatarFrame] = useState<string>(u.avatarFrame || "");
  const [feedPriorityAccount, setFeedPriorityAccount] = useState<
    "suppress" | "low" | "standard" | "high" | "boost"
  >(u.feedPriorityAccount || "standard");
  const [messagingRestricted, setMessaging] = useState(u.restrictions.messagingRestricted);
  const [liveRestricted, setLive] = useState(u.restrictions.liveRestricted);
  const [loginRestricted, setLogin] = useState(u.restrictions.loginRestricted);
  const [accountRestricted, setAccount] = useState(u.restrictions.accountRestricted);
  const [reason, setReason] = useState(u.restrictions.reason || "");
  const [banReason, setBanReason] = useState("");
  const [msgSubject, setMsgSubject] = useState("");
  const [msgBody, setMsgBody] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

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
    <div className="stack" style={{ gap: 16 }}>
      {msg && <div style={{ color: "var(--success)", fontSize: 13 }}>{msg}</div>}
      {err && <ErrorNote>{err}</ErrorNote>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div className="stack" style={{ gap: 16 }}>
          <div className="card stack">
            <h3 className="panel-title">Capabilities</h3>
            <Toggle checked={verified} onChange={setVerified} label="Verified" />
            <div>
              <label>Verification note</label>
              <input value={verificationNote} onChange={(e) => setVerificationNote(e.target.value)} />
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
              <select value={avatarFrame} onChange={(e) => setAvatarFrame(e.target.value)}>
                <option value="">None</option>
                <option value="gold_crown">gold_crown</option>
              </select>
            </div>
            <Toggle checked={messagingRestricted} onChange={setMessaging} label="Messaging restricted" />
            <Toggle checked={liveRestricted} onChange={setLive} label="Live restricted" />
            <Toggle checked={loginRestricted} onChange={setLogin} label="Login restricted" />
            <Toggle checked={accountRestricted} onChange={setAccount} label="Account restricted" />
            <div>
              <label>Reason</label>
              <input value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <button
              className="btn"
              disabled={busy === "caps" || !canCaps}
              title={!canCaps ? "Missing users.capabilities" : undefined}
              onClick={() =>
                run("caps", () => api.post(`/admin/users/${encodeURIComponent(u.userId)}/capabilities`, {
                  verified, role, verificationNote: verificationNote || null,
                  messagingRestricted, liveRestricted, loginRestricted, accountRestricted,
                  reason: reason || null, avatarFrame: avatarFrame || null,
                }), "Capabilities saved.")
              }
            >
              {busy === "caps" ? "Saving…" : "Save capabilities"}
            </button>
          </div>

          <div className="card stack">
            <h3 className="panel-title">Feed priority</h3>
            <select value={feedPriorityAccount} onChange={(e) => setFeedPriorityAccount(e.target.value as typeof feedPriorityAccount)}>
              {(["suppress", "low", "standard", "high", "boost"] as const).map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <button
              className="btn"
              disabled={busy === "feed" || !canFeed}
              title={!canFeed ? "Missing growth.feed_priority" : undefined}
              onClick={() =>
                run("feed", () => api.post(`/admin/users/${encodeURIComponent(u.userId)}/feed-priority`, {
                  priority: feedPriorityAccount,
                  reason: reason || "admin console",
                }), "Feed priority updated.")
              }
            >
              {busy === "feed" ? "Saving…" : "Set feed priority"}
            </button>
          </div>
        </div>

        <div className="stack" style={{ gap: 16 }}>
          <div className="card stack">
            <h3 className="panel-title">Ban / unban</h3>
            {u.isBanned ? (
              <button className="btn success" disabled={busy === "ban" || !canUnban} onClick={() => run("ban", () => api.post(`/admin/users/${encodeURIComponent(u.userId)}/unban`, { reason: banReason || null }), "User unbanned.")}>
                {busy === "ban" ? "Working…" : "Unban user"}
              </button>
            ) : (
              <>
                <div>
                  <label>Reason</label>
                  <input value={banReason} onChange={(e) => setBanReason(e.target.value)} placeholder="Reason (recorded in audit log)" />
                </div>
                <button className="btn danger" disabled={busy === "ban" || !canBan} onClick={() => run("ban", () => api.post(`/admin/users/${encodeURIComponent(u.userId)}/ban`, { reason: banReason || null, bannedUntil: null }), "User banned.")}>
                  {busy === "ban" ? "Working…" : "Ban user"}
                </button>
              </>
            )}
          </div>

          <div className="card stack">
            <h3 className="panel-title">Chargeback / fraud flags</h3>
            <InfoNote>
              Manual flags feed WithdrawalGuard (<code>OPEN_CHARGEBACK</code> / frozen / fraud review). Stripe/Play ingest is not wired. Withdrawals env remains OFF.
            </InfoNote>
            <div className="row wrap" style={{ gap: 10 }}>
              <label className="row" style={{ gap: 6, margin: 0 }}>
                <input
                  type="checkbox"
                  checked={(u.fraud?.openChargebackCount || 0) > 0}
                  disabled={busy === "fraud" || !canBan}
                  onChange={(e) =>
                    run(
                      "fraud",
                      () =>
                        api.post(`/admin/users/${encodeURIComponent(u.userId)}/fraud-flags`, {
                          openChargebackCount: e.target.checked ? 1 : 0,
                          note: e.target.checked ? "admin console chargeback open" : "cleared",
                        }),
                      e.target.checked ? "Chargeback flag set (withdraw block)." : "Chargeback flag cleared.",
                    )
                  }
                />
                <span>Open chargeback</span>
              </label>
              <label className="row" style={{ gap: 6, margin: 0 }}>
                <input
                  type="checkbox"
                  checked={u.fraud?.accountFrozen === true}
                  disabled={busy === "fraud" || !canBan}
                  onChange={(e) =>
                    run(
                      "fraud",
                      () =>
                        api.post(`/admin/users/${encodeURIComponent(u.userId)}/fraud-flags`, {
                          accountFrozen: e.target.checked,
                        }),
                      "Account frozen flag updated.",
                    )
                  }
                />
                <span>Account frozen</span>
              </label>
              <label className="row" style={{ gap: 6, margin: 0 }}>
                <input
                  type="checkbox"
                  checked={u.fraud?.underFraudReview === true}
                  disabled={busy === "fraud" || !canBan}
                  onChange={(e) =>
                    run(
                      "fraud",
                      () =>
                        api.post(`/admin/users/${encodeURIComponent(u.userId)}/fraud-flags`, {
                          underFraudReview: e.target.checked,
                        }),
                      "Fraud review flag updated.",
                    )
                  }
                />
                <span>Under fraud review</span>
              </label>
            </div>
            {u.fraud?.chargebackNote && <p className="dim" style={{ fontSize: 12, margin: 0 }}>Note: {u.fraud.chargebackNote}</p>}
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
              disabled={busy === "msg" || !msgBody.trim() || !canMsg}
              title={!canMsg ? "Missing users.message" : undefined}
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
  const { can } = useAuth();
  const canCredit = can("economy.credit");
  const [coins, setCoins] = useState("");
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const dual = useAsync<{ dualControlUi?: { creditCoinsWarnAt: number; note: string } }>(
    () => api.get("/admin/ops/control-plane"),
    [],
  );
  const warnAt = dual.data?.dualControlUi?.creditCoinsWarnAt ?? 10_000;

  const amount = Math.floor(Number(coins));
  const validAmount = Number.isFinite(amount) && amount >= 1 && amount <= 1_000_000;

  async function submit() {
    if (!canCredit) {
      setErr("Missing economy.credit permission");
      return;
    }
    if (!validAmount) return;
    if (amount >= warnAt) {
      const ok = window.confirm(
        `DUAL-CONTROL WARNING (UI only): ${amount.toLocaleString()} coins ≥ ${warnAt.toLocaleString()} threshold.\nMaker-checker is NOT enforced server-side yet. Continue?`,
      );
      if (!ok) return;
    }
    setBusy(true); setErr(null); setMsg(null);
    try {
      const idempotencyKey =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `admin-dash-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const res = await api.post<{ coinsCredited: number; newBalance: number; currency?: string; ledgerId?: string }>(
        `/admin/users/${encodeURIComponent(u.userId)}/credit-coins`,
        { coins: amount, reason: reason || undefined, idempotencyKey }
      );
      setMsg(
        `Credited ${res.coinsCredited.toLocaleString()} ${res.currency || "BONUS_COIN"} (non-withdrawable). Bonus balance: ${res.newBalance.toLocaleString()}.${res.ledgerId ? ` Ledger: ${res.ledgerId}` : ""}`,
      );
      setCoins(""); setReason(""); setConfirming(false);
      reload();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!canCredit) {
    return (
      <div className="card stack">
        <h3 className="panel-title">Wallet · add bonus coins</h3>
        <InfoNote>
          Coin credit is Owner-only (<code>economy.credit</code>). Balances and ledger remain on User 360 / Economy.
        </InfoNote>
      </div>
    );
  }

  return (
    <div className="card stack">
      <h3 className="panel-title">Wallet · add bonus coins</h3>
      <p className="dim" style={{ fontSize: 12.5, marginTop: 0, lineHeight: 1.5 }}>
        Credits land as <strong>BONUS_COIN</strong> (spendable, non-withdrawable). Visible in User 360 ledger and Economy explorer as{" "}
        <code>ADMIN_CREDIT</code>.
      </p>
      {amount >= warnAt && validAmount && (
        <WarnNote>Amount crosses dual-control UI threshold ({warnAt.toLocaleString()}). Second approver not enforced yet.</WarnNote>
      )}
      {msg && <div style={{ color: "var(--success)", fontSize: 13 }}>{msg}</div>}
      {err && <ErrorNote>{err}</ErrorNote>}
      <div className="row" style={{ gap: 12 }}>
        <div className="grow">
          <label>Bonus coins to add</label>
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
          Add bonus coins
        </button>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          <div className="muted" style={{ fontSize: 13 }}>
            Confirm crediting <strong>{amount.toLocaleString()}</strong> non-withdrawable bonus coins to {u.displayName || u.username || u.userId}.
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn" disabled={busy} onClick={submit}>
              {busy ? "Crediting…" : "Confirm & add bonus coins"}
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
