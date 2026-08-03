import { useState } from "react";
import { api } from "../api/client";
import { useAsync } from "../lib/useAsync";
import { fmtNum } from "../lib/format";
import { PageHeader, Spinner, ErrorNote, Badge, EmptyState } from "../components/ui";
import type { CatalogResponse } from "../types";

function FeatureFlags() {
  const res = useAsync<{ flags: Record<string, boolean> }>(() => api.get("/admin/config/flags"), []);
  const [draft, setDraft] = useState<Record<string, boolean> | null>(null);
  const [newFlag, setNewFlag] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const flags = draft ?? res.data?.flags ?? {};

  function addFlag() {
    const key = newFlag.trim().replace(/\s+/g, "_");
    if (!key || key in flags) return;
    setDraft({ ...flags, [key]: false });
    setNewFlag("");
  }

  async function save() {
    setBusy(true); setErr(null); setNote(null);
    try {
      await api.post("/admin/config/flags", { flags });
      setDraft(null);
      setNote("Saved.");
      res.reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const keys = Object.keys(flags).sort();

  return (
    <div className="card stack">
      <h3 className="panel-title">Feature flags</h3>
      {res.loading && <Spinner />}
      {res.error && <ErrorNote>{res.error}</ErrorNote>}
      {keys.length === 0 && !res.loading && <EmptyState>No flags yet. Add one below.</EmptyState>}
      {keys.map((k) => (
        <label key={k} className="row spread" style={{ cursor: "pointer", margin: 0, borderBottom: "1px solid var(--divider)", paddingBottom: 8 }}>
          <span className="mono" style={{ fontSize: 13 }}>{k}</span>
          <input type="checkbox" style={{ width: 18, height: 18 }} checked={!!flags[k]} onChange={(e) => setDraft({ ...flags, [k]: e.target.checked })} />
        </label>
      ))}
      <div className="row" style={{ gap: 8 }}>
        <input value={newFlag} onChange={(e) => setNewFlag(e.target.value)} placeholder="new_flag_name" onKeyDown={(e) => e.key === "Enter" && addFlag()} />
        <button className="btn ghost tiny" onClick={addFlag}>Add</button>
      </div>
      {note && <div style={{ color: "var(--success)", fontSize: 13 }}>{note}</div>}
      {err && <ErrorNote>{err}</ErrorNote>}
      <button className="btn" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save flags"}</button>
    </div>
  );
}

function Catalog() {
  const res = useAsync<CatalogResponse>(() => api.get<CatalogResponse>("/admin/config/catalog"), []);
  const [busy, setBusy] = useState<string | null>(null);

  async function toggle(giftId: string, enabled: boolean) {
    setBusy(giftId);
    try {
      await api.post(`/admin/config/gift/${encodeURIComponent(giftId)}`, { enabled });
      res.reload();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack">
      <div className="card">
        <div className="row spread" style={{ marginBottom: 8 }}>
          <h3 className="panel-title" style={{ margin: 0 }}>Gift catalog</h3>
          <button className="btn ghost tiny" onClick={() => res.reload()}>Refresh</button>
        </div>
        {res.loading && <Spinner />}
        {res.error && <ErrorNote>{res.error}</ErrorNote>}
        {res.data && (
          res.data.gifts.length === 0 ? <EmptyState>No gifts configured.</EmptyState> : (
            <div className="table-wrap" style={{ maxHeight: 320 }}>
              <table>
                <thead><tr><th>Gift</th><th>Rarity</th><th style={{ textAlign: "right" }}>Cost</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {res.data.gifts.map((g) => (
                    <tr key={g.giftId}>
                      <td>{g.name}</td>
                      <td><span className="dim">{g.rarity}</span></td>
                      <td style={{ textAlign: "right" }}>{fmtNum(g.coinCost)} 🪙</td>
                      <td>{g.enabled ? <Badge kind="ok">Enabled</Badge> : <Badge kind="neutral">Disabled</Badge>}</td>
                      <td style={{ textAlign: "right" }}>
                        <button className={g.enabled ? "btn ghost tiny" : "btn tiny"} disabled={busy === g.giftId} onClick={() => toggle(g.giftId, !g.enabled)}>
                          {g.enabled ? "Disable" : "Enable"}
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

      <div className="card">
        <h3 className="panel-title">Coin packs (IAP)</h3>
        {res.data && (
          res.data.iapProducts.length === 0 ? <EmptyState>No products configured.</EmptyState> : (
            <div className="table-wrap" style={{ maxHeight: 280 }}>
              <table>
                <thead><tr><th>SKU</th><th>Platform</th><th style={{ textAlign: "right" }}>Coins</th><th>Status</th></tr></thead>
                <tbody>
                  {res.data.iapProducts.map((p) => (
                    <tr key={`${p.platform}:${p.sku}`}>
                      <td className="mono" style={{ fontSize: 12 }}>{p.sku}</td>
                      <td><span className="dim">{p.platform}</span></td>
                      <td style={{ textAlign: "right" }}>{fmtNum(p.coinsGranted)}</td>
                      <td>{p.enabled ? <Badge kind="ok">Enabled</Badge> : <Badge kind="neutral">Disabled</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </div>
  );
}

export default function Config() {
  return (
    <div>
      <PageHeader title="Configuration" subtitle="Feature flags, gift catalog, and coin packs" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr", gap: 16 }}>
        <FeatureFlags />
        <Catalog />
      </div>
    </div>
  );
}
