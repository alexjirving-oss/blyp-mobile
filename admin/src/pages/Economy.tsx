import { useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/useAuth";
import { useAsync } from "../lib/useAsync";
import { fmtNum, fmtRelative } from "../lib/format";
import { PageHeader, StatCard, Spinner, ErrorNote, Badge, WarnNote, InfoNote, EmptyState } from "../components/ui";
import { useToast } from "../components/Toast";
import type {
  MetricsOverview,
  OpsControlPlane,
  LedgerResponse,
  IapPurchasesResponse,
  FraudSignalsResponse,
} from "../types";

type Tab = "withdrawals" | "ledger" | "iap" | "fraud" | "chargebacks";

type WithdrawalRow = {
  withdrawalId: string;
  userId: string;
  amountGems: number;
  feeGems: number;
  netGems: number;
  netMinor: number;
  currency: string;
  status: string;
  reasons?: unknown;
  stripeTransferId?: string | null;
  createdAt: string | null;
  settledAt?: string | null;
};

type WithdrawalsResponse = {
  items: WithdrawalRow[];
  status: string;
  limit: number;
  offset: number;
};

export default function Economy() {
  const toast = useToast();
  const { can } = useAuth();
  const canApprove = can("economy.withdraw.approve");
  const canReject = can("economy.withdraw.reject");
  const [tab, setTab] = useState<Tab>("withdrawals");
  const metrics = useAsync<MetricsOverview>(() => api.get<MetricsOverview>("/admin/metrics/overview"), []);
  const control = useAsync<OpsControlPlane>(() => api.get<OpsControlPlane>("/admin/ops/control-plane"), []);
  const withdrawals = useAsync<WithdrawalsResponse>(
    () => api.get<WithdrawalsResponse>("/admin/withdrawals?status=pending_review&limit=50"),
    [],
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);

  const m = metrics.data;
  const w = control.data?.withdrawals;
  const dual = control.data?.dualControlUi;
  const payoutsLive = Boolean(w?.effectivelyEnabled);
  const warnGems = dual?.withdrawalApproveWarnAtGems ?? 50_000;

  async function approve(row: WithdrawalRow) {
    if (!canApprove) {
      toast.push("Owner-only: missing economy.withdraw.approve", "err");
      return;
    }
    if (!payoutsLive) {
      toast.push("Withdrawals kill-switch is OFF — approve blocked in UI", "err");
      return;
    }
    if (row.amountGems >= warnGems) {
      const ok = window.confirm(
        `DUAL-CONTROL WARNING (UI only): ${fmtNum(row.amountGems)} gems ≥ ${fmtNum(warnGems)} threshold.\nMaker-checker is NOT enforced server-side yet. Continue?`,
      );
      if (!ok) return;
    }
    const reason = window.prompt("Approval note (recommended for audit):", "Manual review approved");
    if (reason === null) return;
    if (!window.confirm("Approve this withdrawal? This runs a Stripe Connect transfer when enabled.")) return;
    setBusyId(row.withdrawalId);
    setActionErr(null);
    try {
      const out = await api.post<WithdrawalRow>(`/admin/withdrawals/${encodeURIComponent(row.withdrawalId)}/approve`, {
        reason: reason?.trim() || undefined,
      });
      toast.push(`Approved → ${out.status}${out.stripeTransferId ? ` (${out.stripeTransferId})` : ""}`, "ok");
      withdrawals.reload();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : String(e);
      setActionErr(msg);
      toast.push(msg, "err");
    } finally {
      setBusyId(null);
    }
  }

  async function reject(id: string) {
    if (!canReject) {
      toast.push("Missing economy.withdraw.reject", "err");
      return;
    }
    const reason = window.prompt("Reject reason (required for audit):");
    if (reason === null) return;
    if (!reason.trim()) {
      toast.push("Rejection reason is required", "err");
      return;
    }
    setBusyId(id);
    setActionErr(null);
    try {
      await api.post(`/admin/withdrawals/${encodeURIComponent(id)}/reject`, {
        reason: reason.trim(),
      });
      toast.push("Rejected — reserved gems restored", "ok");
      withdrawals.reload();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : String(e);
      setActionErr(msg);
      toast.push(msg, "err");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Economy & Finance"
        subtitle="Withdrawals, ledger explorer, IAP desk, gift fraud signals"
        actions={
          <button
            className="btn ghost tiny"
            onClick={() => {
              metrics.reload();
              withdrawals.reload();
              control.reload();
            }}
          >
            Refresh
          </button>
        }
      />

      {control.loading && <Spinner label="Loading withdrawal readiness…" />}
      {control.error && <ErrorNote>Control plane unavailable: {control.error}</ErrorNote>}
      {w && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="row spread wrap" style={{ gap: 10, marginBottom: 10 }}>
            <h3 className="panel-title" style={{ margin: 0 }}>Withdrawal readiness</h3>
            <Badge kind={payoutsLive ? "ok" : "err"}>{payoutsLive ? "PAYOUTS LIVE" : "PAYOUTS DISABLED"}</Badge>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10, marginBottom: 10 }}>
            <div>
              <div className="dim" style={{ fontSize: 11 }}>ENABLE_WITHDRAWALS</div>
              <div style={{ fontWeight: 700 }}>{w.enableWithdrawalsEnv ? "1" : "0"}</div>
            </div>
            <div>
              <div className="dim" style={{ fontSize: 11 }}>Stripe secret</div>
              <div style={{ fontWeight: 700 }}>
                {w.stripeConfigured
                  ? w.stripeKeyMode === "live"
                    ? "live"
                    : w.stripeKeyMode === "test"
                      ? "test"
                      : w.stripeKeyMode || "yes"
                  : "no"}
              </div>
            </div>
            <div>
              <div className="dim" style={{ fontSize: 11 }}>Webhook secret</div>
              <div style={{ fontWeight: 700 }}>{w.stripeWebhookConfigured ? "yes" : "no"}</div>
            </div>
            <div>
              <div className="dim" style={{ fontSize: 11 }}>Effective</div>
              <div style={{ fontWeight: 700 }}>{w.effectivelyEnabled ? "enabled" : "disabled"}</div>
            </div>
          </div>
          {!payoutsLive ? (
            <WarnNote>
              {w.note}.{" "}
              {w.stripeKeyMode === "test"
                ? "Cloud Run still has sk_test_ — paste live keys before flipping ENABLE_WITHDRAWALS."
                : w.stripeLiveKeyPresent
                  ? "Live key detected; kill-switch still OFF (Cloud Run env only)."
                  : "Stripe not live-ready yet."}{" "}
              Queue may still show historical <code>pending_review</code> rows. Do not tell creators payouts work.
            </WarnNote>
          ) : (
            <InfoNote>
              {w.note}. {w.stripeNote || "Approve executes Stripe Connect transfer; reject restores reserved gems."}
            </InfoNote>
          )}
          {dual && (
            <div style={{ marginTop: 10 }}>
              <InfoNote>
                Dual-control UI thresholds: credit ≥ {fmtNum(dual.creditCoinsWarnAt)} coins · withdraw ≥{" "}
                {fmtNum(dual.withdrawalApproveWarnAtGems)} gems. {dual.note}
              </InfoNote>
            </div>
          )}
        </div>
      )}

      {metrics.loading && <Spinner />}
      {metrics.error && <ErrorNote>{metrics.error}</ErrorNote>}
      {m && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12, marginBottom: 16 }}>
          <StatCard label="Total coin supply" value={fmtNum(m.totalCoinSupply)} hint="Wallet + bonus balances" />
          <StatCard label="Gifts · 24h" value={fmtNum(m.gifts24h)} />
          <StatCard label="Ledger entries · 24h" value={fmtNum(m.ledgerEntries24h)} />
          <StatCard label="Active subscriptions" value={fmtNum(m.activeSubscriptions)} />
        </div>
      )}

      <div className="row" style={{ gap: 6, marginBottom: 14 }}>
        {([
          ["withdrawals", "Withdrawals"],
          ["ledger", "Ledger"],
          ["iap", "IAP desk"],
          ["fraud", "Fraud signals"],
          ["chargebacks", "Chargebacks"],
        ] as const).map(([k, label]) => (
          <button key={k} className={tab === k ? "btn tiny" : "btn ghost tiny"} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "withdrawals" && (
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
            <h3 className="panel-title" style={{ margin: 0 }}>Withdrawals · pending review</h3>
            <Badge kind={(withdrawals.data?.items?.length || 0) > 0 ? "warn" : "ok"}>
              {withdrawals.data?.items?.length ?? "—"} queued
            </Badge>
          </div>
          {actionErr && <ErrorNote>{actionErr}</ErrorNote>}
          {withdrawals.loading && <Spinner label="Loading withdrawal queue…" />}
          {withdrawals.error && <ErrorNote>{withdrawals.error}</ErrorNote>}
          {withdrawals.data && withdrawals.data.items.length === 0 && (
            <div className="dim" style={{ fontSize: 13 }}>
              {payoutsLive
                ? "No pending_review withdrawals."
                : "No pending_review rows. Kill-switch is off — empty queue is expected if clients never opened cash-out."}
            </div>
          )}
          {withdrawals.data && withdrawals.data.items.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "var(--text-2)" }}>
                    <th style={{ padding: "8px 6px" }}>Created</th>
                    <th style={{ padding: "8px 6px" }}>User</th>
                    <th style={{ padding: "8px 6px" }}>Gross</th>
                    <th style={{ padding: "8px 6px" }}>Net</th>
                    <th style={{ padding: "8px 6px" }}>Reasons</th>
                    <th style={{ padding: "8px 6px" }} />
                  </tr>
                </thead>
                <tbody>
                  {withdrawals.data.items.map((row) => (
                    <tr key={row.withdrawalId} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "10px 6px", whiteSpace: "nowrap" }}>
                        {row.createdAt ? fmtRelative(row.createdAt) : "—"}
                      </td>
                      <td className="mono" style={{ padding: "10px 6px", fontSize: 11 }}>
                        <Link to={`/people/${encodeURIComponent(row.userId)}`}>{row.userId.slice(0, 12)}…</Link>
                      </td>
                      <td style={{ padding: "10px 6px" }}>
                        {fmtNum(row.amountGems)} gems
                        {row.amountGems >= warnGems && (
                          <>
                            {" "}
                            <Badge kind="warn">dual-control</Badge>
                          </>
                        )}
                      </td>
                      <td style={{ padding: "10px 6px" }}>
                        {fmtNum(row.netGems)} · {row.netMinor} {String(row.currency || "").toUpperCase()}
                      </td>
                      <td style={{ padding: "10px 6px", maxWidth: 220 }}>
                        <span className="dim" style={{ fontSize: 11 }}>
                          {Array.isArray(row.reasons) ? row.reasons.join(", ") : "—"}
                        </span>
                      </td>
                      <td style={{ padding: "10px 6px", whiteSpace: "nowrap" }}>
                        <button
                          className="btn tiny"
                          disabled={busyId === row.withdrawalId || !payoutsLive || !canApprove}
                          title={
                            !canApprove
                              ? "Owner-only permission"
                              : payoutsLive
                                ? "Approve Stripe transfer"
                                : "Blocked — withdrawals disabled"
                          }
                          onClick={() => approve(row)}
                        >
                          {busyId === row.withdrawalId ? "…" : "Approve"}
                        </button>{" "}
                        <button
                          className="btn ghost tiny"
                          disabled={busyId === row.withdrawalId || !canReject}
                          title={!canReject ? "Missing permission" : undefined}
                          onClick={() => reject(row.withdrawalId)}
                        >
                          Reject
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "ledger" && <LedgerExplorer />}
      {tab === "iap" && <IapDesk />}
      {tab === "fraud" && <FraudDesk />}
      {tab === "chargebacks" && <ChargebackDesk />}
    </div>
  );
}

function LedgerExplorer() {
  const [userId, setUserId] = useState("");
  const [ledgerId, setLedgerId] = useState("");
  const [entryType, setEntryType] = useState("");
  const [qKey, setQKey] = useState(0);
  const qs = new URLSearchParams();
  if (userId.trim()) qs.set("userId", userId.trim());
  if (ledgerId.trim()) qs.set("ledgerId", ledgerId.trim());
  if (entryType) qs.set("entryType", entryType);
  qs.set("limit", "50");
  const ready = Boolean(userId.trim() || ledgerId.trim() || entryType);
  const res = useAsync<LedgerResponse>(
    () => (ready ? api.get<LedgerResponse>(`/admin/ledger?${qs.toString()}`) : Promise.resolve({ items: [], nextCursor: null, detail: "require_filter" })),
    [qKey],
  );

  return (
    <div className="card stack">
      <h3 className="panel-title">Ledger explorer</h3>
      <p className="dim" style={{ fontSize: 12.5, marginTop: 0 }}>
        Search by Cognito sub, ledger id, or type alias (credit / debit / gift / purchase / admin). Admin credits appear as{" "}
        <code>ADMIN_CREDIT</code>.
      </p>
      <div className="row wrap" style={{ gap: 10 }}>
        <div className="grow">
          <label>User ID</label>
          <input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="Cognito sub" />
        </div>
        <div className="grow">
          <label>Ledger / tx id</label>
          <input value={ledgerId} onChange={(e) => setLedgerId(e.target.value)} placeholder="ledger_id" />
        </div>
        <div>
          <label>Type</label>
          <select value={entryType} onChange={(e) => setEntryType(e.target.value)}>
            <option value="">Any</option>
            <option value="credit">credit</option>
            <option value="debit">debit</option>
            <option value="gift">gift</option>
            <option value="purchase">purchase</option>
            <option value="admin">admin</option>
            <option value="ADMIN_CREDIT">ADMIN_CREDIT</option>
            <option value="COIN_PURCHASE">COIN_PURCHASE</option>
          </select>
        </div>
        <div style={{ alignSelf: "flex-end" }}>
          <button className="btn" disabled={!ready} onClick={() => setQKey((k) => k + 1)}>
            Search
          </button>
        </div>
      </div>
      {!ready && <InfoNote>Enter at least one filter, then Search.</InfoNote>}
      {res.loading && <Spinner />}
      {res.error && <ErrorNote>{res.error}</ErrorNote>}
      {res.data?.degraded && <ErrorNote>{res.data.detail}</ErrorNote>}
      {res.data && ready && !res.loading && (
        res.data.items.length === 0 ? (
          <EmptyState>No ledger rows for this filter.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>User</th>
                  <th>Type</th>
                  <th>Amount</th>
                  <th>Ref</th>
                  <th>Ledger id</th>
                </tr>
              </thead>
              <tbody>
                {res.data.items.map((row) => (
                  <tr key={row.ledgerId}>
                    <td className="muted" style={{ fontSize: 12 }}>{fmtRelative(row.createdAt)}</td>
                    <td className="mono" style={{ fontSize: 11 }}>
                      <Link to={`/people/${encodeURIComponent(row.userId)}`}>{row.userId.slice(0, 12)}…</Link>
                    </td>
                    <td><Badge kind={row.entryType === "ADMIN_CREDIT" ? "info" : "neutral"}>{row.entryType}</Badge></td>
                    <td>
                      {fmtNum(row.amount)} <span className="dim">{row.currency}</span>
                    </td>
                    <td className="dim" style={{ fontSize: 11 }}>
                      {row.referenceType || "—"} {row.referenceId ? `· ${String(row.referenceId).slice(0, 16)}` : ""}
                    </td>
                    <td className="mono" style={{ fontSize: 10 }}>{row.ledgerId.slice(0, 18)}…</td>
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

function IapDesk() {
  const [userId, setUserId] = useState("");
  const [q, setQ] = useState("");
  const [qKey, setQKey] = useState(0);
  const qs = new URLSearchParams({ limit: "50" });
  if (userId.trim()) qs.set("userId", userId.trim());
  if (q.trim()) qs.set("q", q.trim());
  const res = useAsync<IapPurchasesResponse>(
    () => api.get<IapPurchasesResponse>(`/admin/iap/purchases?${qs.toString()}`),
    [qKey],
  );

  return (
    <div className="card stack">
      <h3 className="panel-title">IAP / purchase desk</h3>
      <p className="dim" style={{ fontSize: 12.5, marginTop: 0 }}>
        Source of truth: <code>ledger_entries</code> with <code>COIN_PURCHASE</code>. No separate receipts table — token-reuse
        rejects are not persisted as rows.
      </p>
      <div className="row wrap" style={{ gap: 10 }}>
        <div className="grow">
          <label>User ID</label>
          <input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="Optional Cognito sub" />
        </div>
        <div className="grow">
          <label>Search</label>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="sku / store tx / token" />
        </div>
        <div style={{ alignSelf: "flex-end" }}>
          <button className="btn" onClick={() => setQKey((k) => k + 1)}>Load</button>
        </div>
      </div>
      {res.loading && <Spinner />}
      {res.error && <ErrorNote>{res.error}</ErrorNote>}
      {res.data?.note && <InfoNote>{res.data.note}</InfoNote>}
      {res.data && !res.loading && (
        res.data.items.length === 0 ? (
          <EmptyState>No IAP grant rows found (honest empty).</EmptyState>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>User</th>
                  <th>Platform</th>
                  <th>SKU</th>
                  <th>Coins</th>
                  <th>Hints</th>
                </tr>
              </thead>
              <tbody>
                {res.data.items.map((row) => (
                  <tr key={row.ledgerId}>
                    <td className="muted" style={{ fontSize: 12 }}>{fmtRelative(row.createdAt)}</td>
                    <td className="mono" style={{ fontSize: 11 }}>
                      <Link to={`/people/${encodeURIComponent(row.userId)}`}>{row.userId.slice(0, 12)}…</Link>
                    </td>
                    <td>{row.platform || "—"}</td>
                    <td className="mono" style={{ fontSize: 11 }}>{row.sku || "—"}</td>
                    <td>{fmtNum(row.amount)}</td>
                    <td>
                      {row.anomalyHints?.length
                        ? row.anomalyHints.map((h) => <Badge key={h} kind="warn">{h}</Badge>)
                        : <span className="dim">—</span>}
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

function FraudDesk() {
  const res = useAsync<FraudSignalsResponse>(() => api.get<FraudSignalsResponse>("/admin/fraud/signals?hours=24&minGifts=8"), []);
  const d = res.data;
  return (
    <div className="stack" style={{ gap: 14 }}>
      {res.loading && <Spinner label="Computing gift fraud signals…" />}
      {res.error && <ErrorNote>{res.error}</ErrorNote>}
      {d?.note && <InfoNote>{d.note}</InfoNote>}
      {d && !d.deviceReuse.available && (
        <WarnNote>Device reuse graph: unavailable ({d.deviceReuse.detail}).</WarnNote>
      )}
      {d && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div className="card">
            <h3 className="panel-title">Rapid gift pairs · {d.windowHours}h</h3>
            {d.rapidPairs.length === 0 ? <EmptyState>No rapid pairs above threshold.</EmptyState> : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Sender</th><th>Receiver</th><th>Gifts</th><th>Coins</th></tr></thead>
                  <tbody>
                    {d.rapidPairs.map((p) => (
                      <tr key={`${p.senderUserId}-${p.receiverUserId}`}>
                        <td className="mono" style={{ fontSize: 11 }}><Link to={`/people/${encodeURIComponent(p.senderUserId)}`}>{p.senderUserId.slice(0, 10)}…</Link></td>
                        <td className="mono" style={{ fontSize: 11 }}><Link to={`/people/${encodeURIComponent(p.receiverUserId)}`}>{p.receiverUserId.slice(0, 10)}…</Link></td>
                        <td>{fmtNum(p.giftCount)}</td>
                        <td>{fmtNum(p.coinSpent)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="card">
            <h3 className="panel-title">Circular gift hints</h3>
            {d.circularHints.length === 0 ? <EmptyState>No reciprocal pairs detected.</EmptyState> : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>A</th><th>B</th><th>A→B</th><th>B→A</th></tr></thead>
                  <tbody>
                    {d.circularHints.map((p) => (
                      <tr key={`${p.userA}-${p.userB}`}>
                        <td className="mono" style={{ fontSize: 11 }}><Link to={`/people/${encodeURIComponent(p.userA)}`}>{p.userA.slice(0, 10)}…</Link></td>
                        <td className="mono" style={{ fontSize: 11 }}><Link to={`/people/${encodeURIComponent(p.userB)}`}>{p.userB.slice(0, 10)}…</Link></td>
                        <td>{fmtNum(p.aToB)}</td>
                        <td>{fmtNum(p.bToA)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ChargebackDesk() {
  const toast = useToast();
  const res = useAsync<{
    openChargebackCount: number;
    flaggedUsers?: Array<{ userId: string; flags: { openChargebackCount: number; accountFrozen: boolean; underFraudReview: boolean; chargebackNote: string | null } }>;
    chargebackIngest: { wired: boolean; detail: string };
    withdrawBlockWired?: boolean;
    iapAnomalies: Array<{ ledgerId: string; userId: string; anomalyHints: string[]; amount?: number; createdAt?: string }>;
    note?: string;
  }>(() => api.get("/admin/fraud/chargebacks"), []);
  const d = res.data;
  return (
    <div className="stack" style={{ gap: 14 }}>
      {res.loading && <Spinner label="Loading chargeback / IAP anomalies…" />}
      {res.error && <ErrorNote>{res.error}</ErrorNote>}
      {d?.note && <InfoNote>{d.note}</InfoNote>}
      {d && (
        <>
          <WarnNote>
            Flagged users with open chargeback: <strong>{d.openChargebackCount}</strong>.
            Withdraw block wired: {d.withdrawBlockWired ? "yes" : "no"}. {d.chargebackIngest.detail}
          </WarnNote>
          <div className="card">
            <div className="row spread">
              <h3 className="panel-title" style={{ margin: 0 }}>Users with open chargeback flag</h3>
              <button className="btn ghost tiny" onClick={() => res.reload()}>Refresh</button>
            </div>
            {!d.flaggedUsers?.length ? (
              <EmptyState>No users with openChargebackCount &gt; 0. Set flags on Person → Controls.</EmptyState>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>User</th><th>Count</th><th>Frozen</th><th>Fraud review</th><th>Note</th></tr></thead>
                  <tbody>
                    {d.flaggedUsers.map((row) => (
                      <tr key={row.userId}>
                        <td className="mono" style={{ fontSize: 11 }}>
                          <Link to={`/people/${encodeURIComponent(row.userId)}`}>{row.userId.slice(0, 12)}…</Link>
                        </td>
                        <td>{row.flags.openChargebackCount}</td>
                        <td>{row.flags.accountFrozen ? "yes" : "—"}</td>
                        <td>{row.flags.underFraudReview ? "yes" : "—"}</td>
                        <td className="dim" style={{ fontSize: 12 }}>{row.flags.chargebackNote || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="card">
            <h3 className="panel-title">IAP anomaly hints</h3>
            {d.iapAnomalies.length === 0 ? (
              <EmptyState>No anomaly hints in recent COIN_PURCHASE rows.</EmptyState>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>User</th>
                      <th>Hints</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.iapAnomalies.map((row) => (
                      <tr key={row.ledgerId}>
                        <td>{row.createdAt ? fmtRelative(row.createdAt) : "—"}</td>
                        <td className="mono" style={{ fontSize: 11 }}>
                          <Link to={`/people/${encodeURIComponent(row.userId)}`}>{row.userId.slice(0, 12)}…</Link>
                        </td>
                        <td style={{ fontSize: 12 }}>{row.anomalyHints.join(", ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
      {!d && !res.loading && (
        <button className="btn ghost tiny" onClick={() => { toast.push("Reloaded", "ok"); res.reload(); }}>Retry</button>
      )}
    </div>
  );
}
