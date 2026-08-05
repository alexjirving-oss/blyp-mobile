import { useState } from "react";
import { api, ApiError } from "../api/client";
import { useAsync } from "../lib/useAsync";
import { fmtNum, fmtRelative } from "../lib/format";
import { PageHeader, StatCard, Spinner, ErrorNote, Badge } from "../components/ui";
import type { MetricsOverview } from "../types";

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
  const metrics = useAsync<MetricsOverview>(() => api.get<MetricsOverview>("/admin/metrics/overview"), []);
  const withdrawals = useAsync<WithdrawalsResponse>(
    () => api.get<WithdrawalsResponse>("/admin/withdrawals?status=pending_review&limit=50"),
    [],
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);

  const m = metrics.data;

  async function approve(id: string) {
    setBusyId(id);
    setActionErr(null);
    setActionMsg(null);
    try {
      const out = await api.post<WithdrawalRow>(`/admin/withdrawals/${encodeURIComponent(id)}/approve`, {});
      setActionMsg(`Approved ${id.slice(0, 8)}… → ${out.status}${out.stripeTransferId ? ` (${out.stripeTransferId})` : ""}`);
      withdrawals.reload();
    } catch (e) {
      setActionErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  async function reject(id: string) {
    const reason = window.prompt("Reject reason (optional)") ?? undefined;
    setBusyId(id);
    setActionErr(null);
    setActionMsg(null);
    try {
      await api.post(`/admin/withdrawals/${encodeURIComponent(id)}/reject`, {
        reason: reason?.trim() || undefined,
      });
      setActionMsg(`Rejected ${id.slice(0, 8)}… — gems restored`);
      withdrawals.reload();
    } catch (e) {
      setActionErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Economy & Finance"
        subtitle="Coins, gifting, and creator cash-out review"
        actions={
          <button
            className="btn ghost tiny"
            onClick={() => {
              metrics.reload();
              withdrawals.reload();
            }}
          >
            Refresh
          </button>
        }
      />
      {metrics.loading && <Spinner />}
      {metrics.error && <ErrorNote>{metrics.error}</ErrorNote>}
      {m && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
          <StatCard label="Total coin supply" value={fmtNum(m.totalCoinSupply)} hint="Wallet + bonus balances" />
          <StatCard label="Gifts · 24h" value={fmtNum(m.gifts24h)} />
          <StatCard label="Ledger entries · 24h" value={fmtNum(m.ledgerEntries24h)} />
          <StatCard label="Active subscriptions" value={fmtNum(m.activeSubscriptions)} />
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
          <h3 className="panel-title" style={{ margin: 0 }}>
            Withdrawals · pending review
          </h3>
          <Badge kind={(withdrawals.data?.items?.length || 0) > 0 ? "warn" : "ok"}>
            {withdrawals.data?.items?.length ?? "—"} queued
          </Badge>
        </div>
        <p className="dim" style={{ fontSize: 13, marginTop: 0, lineHeight: 1.5 }}>
          Manual-review cash-outs (large amount, new payout account, or velocity caps). Approve runs a Stripe
          Connect transfer; reject restores reserved gems. Requires live Stripe secrets — see{" "}
          <code>docs/WITHDRAWALS_OPS.md</code>.
        </p>
        {actionMsg && <div style={{ color: "var(--success)", fontSize: 13, marginBottom: 8 }}>{actionMsg}</div>}
        {actionErr && <ErrorNote>{actionErr}</ErrorNote>}
        {withdrawals.loading && <Spinner label="Loading withdrawal queue…" />}
        {withdrawals.error && <ErrorNote>{withdrawals.error}</ErrorNote>}
        {withdrawals.data && withdrawals.data.items.length === 0 && (
          <div className="dim" style={{ fontSize: 13 }}>No pending_review withdrawals.</div>
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
                {withdrawals.data.items.map((w) => (
                  <tr key={w.withdrawalId} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "10px 6px", whiteSpace: "nowrap" }}>
                      {w.createdAt ? fmtRelative(w.createdAt) : "—"}
                    </td>
                    <td className="mono" style={{ padding: "10px 6px", fontSize: 11 }}>
                      {w.userId.slice(0, 12)}…
                    </td>
                    <td style={{ padding: "10px 6px" }}>{fmtNum(w.amountGems)} gems</td>
                    <td style={{ padding: "10px 6px" }}>
                      {fmtNum(w.netGems)} · {w.netMinor} {String(w.currency || "").toUpperCase()}
                    </td>
                    <td style={{ padding: "10px 6px", maxWidth: 220 }}>
                      <span className="dim" style={{ fontSize: 11 }}>
                        {Array.isArray(w.reasons) ? w.reasons.join(", ") : "—"}
                      </span>
                    </td>
                    <td style={{ padding: "10px 6px", whiteSpace: "nowrap" }}>
                      <button
                        className="btn tiny"
                        disabled={busyId === w.withdrawalId}
                        onClick={() => approve(w.withdrawalId)}
                      >
                        {busyId === w.withdrawalId ? "…" : "Approve"}
                      </button>{" "}
                      <button
                        className="btn ghost tiny"
                        disabled={busyId === w.withdrawalId}
                        onClick={() => reject(w.withdrawalId)}
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
        {m && (
          <div className="dim" style={{ fontSize: 12, marginTop: 12 }}>
            Snapshot {fmtRelative(m.generatedAt)}.
          </div>
        )}
      </div>
    </div>
  );
}
