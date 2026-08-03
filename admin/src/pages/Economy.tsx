import { api } from "../api/client";
import { useAsync } from "../lib/useAsync";
import { fmtNum, fmtRelative } from "../lib/format";
import { PageHeader, StatCard, Spinner, ErrorNote } from "../components/ui";
import type { MetricsOverview } from "../types";

export default function Economy() {
  const metrics = useAsync<MetricsOverview>(() => api.get<MetricsOverview>("/admin/metrics/overview"), []);
  const m = metrics.data;

  return (
    <div>
      <PageHeader
        title="Economy & Finance"
        subtitle="Coins, gifting, and the in-app economy"
        actions={<button className="btn ghost tiny" onClick={() => metrics.reload()}>Refresh</button>}
      />
      {metrics.loading && <Spinner />}
      {metrics.error && <ErrorNote>{metrics.error}</ErrorNote>}
      {m && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
            <StatCard label="Total coin supply" value={fmtNum(m.totalCoinSupply)} hint="Wallet + bonus balances" />
            <StatCard label="Gifts · 24h" value={fmtNum(m.gifts24h)} />
            <StatCard label="Ledger entries · 24h" value={fmtNum(m.ledgerEntries24h)} />
            <StatCard label="Active subscriptions" value={fmtNum(m.activeSubscriptions)} />
          </div>
          <div className="card" style={{ marginTop: 16, maxWidth: 720 }}>
            <h3 className="panel-title">Coming next</h3>
            <ul style={{ margin: 0, paddingLeft: 18, color: "var(--text-2)", fontSize: 13.5, lineHeight: 1.9 }}>
              <li>Revenue dashboard from Play/App Store purchase ledger (gross, net, refunds)</li>
              <li>Per-creator earnings & payout readiness</li>
              <li>Full transaction ledger with search and fraud flags</li>
              <li>Coin pack performance & price experiments</li>
            </ul>
            <div className="dim" style={{ fontSize: 12, marginTop: 12 }}>Snapshot {fmtRelative(m.generatedAt)}.</div>
          </div>
        </>
      )}
    </div>
  );
}
