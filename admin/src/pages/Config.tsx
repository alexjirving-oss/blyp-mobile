import { useState } from "react";
import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/useAuth";
import { useAsync } from "../lib/useAsync";
import { fmtNum, fmtRelative } from "../lib/format";
import { PageHeader, Spinner, ErrorNote, Badge, EmptyState, WarnNote, InfoNote } from "../components/ui";
import { useToast } from "../components/Toast";
import type { AppVersionPolicy, CatalogResponse, OpsControlPlane } from "../types";

function KillSwitchBoard() {
  const toast = useToast();
  const { can } = useAuth();
  const canKill = can("kill.global.write");
  const res = useAsync<OpsControlPlane>(() => api.get<OpsControlPlane>("/admin/ops/control-plane"), []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const streaming = res.data?.killSwitches?.streamingEnabled;
  const w = res.data?.withdrawals;

  async function setStreaming(enabled: boolean) {
    if (!canKill) {
      toast.push("Owner-only: missing kill.global.write", "err");
      return;
    }
    const reason = window.prompt(
      enabled ? "Reason for enabling live streaming:" : "Reason for KILLING live streaming (required):",
      enabled ? "Ops restore" : "Incident response"
    );
    if (reason === null) return;
    if (!enabled && !reason.trim()) {
      toast.push("Reason required for kill switch", "err");
      return;
    }
    if (!window.confirm(enabled ? "Enable remote streaming flag?" : "Disable live streaming for builds that honor Firestore override?")) {
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api.post("/admin/config/streaming", { enabled, reason: reason.trim() || undefined });
      toast.push(`Streaming flag → ${enabled ? "enabled" : "disabled"} (audited)`, "ok");
      res.reload();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : String(e);
      setErr(msg);
      toast.push(msg, "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card stack">
      <div className="row spread">
        <h3 className="panel-title" style={{ margin: 0 }}>Kill switches & readiness</h3>
        <button className="btn ghost tiny" onClick={() => res.reload()}>Refresh</button>
      </div>
      {res.loading && <Spinner />}
      {res.error && <ErrorNote>{res.error}</ErrorNote>}
      {err && <ErrorNote>{err}</ErrorNote>}
      {res.data && (
        <>
          <WarnNote>
            <strong>Withdrawals</strong> are Cloud Run env (<code>ENABLE_WITHDRAWALS</code>) — read-only here.
            Do not pretend payouts work when the kill-switch is off.
          </WarnNote>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Control</th>
                  <th>State</th>
                  <th>Notes</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Withdrawals</td>
                  <td>
                    <Badge kind={w?.effectivelyEnabled ? "ok" : "err"}>
                      {w?.effectivelyEnabled ? "LIVE" : "OFF"}
                    </Badge>
                  </td>
                  <td className="dim" style={{ fontSize: 12 }}>
                    env={w?.enableWithdrawalsEnv ? "1" : "0"} · stripe=
                    {w?.stripeConfigured
                      ? w?.stripeKeyMode === "live"
                        ? "live"
                        : w?.stripeKeyMode === "test"
                          ? "test"
                          : "yes"
                      : "no"}
                    {w?.stripeWebhookConfigured != null ? ` · whsec=${w.stripeWebhookConfigured ? "yes" : "no"}` : ""}
                    <div>{w?.note}</div>
                    {w?.stripeNote ? <div>{w.stripeNote}</div> : null}
                  </td>
                  <td className="dim" style={{ fontSize: 11 }}>Cloud Run only</td>
                </tr>
                <tr>
                  <td>Live streaming (Firestore)</td>
                  <td>
                    <Badge kind={streaming === false ? "err" : streaming === true ? "ok" : "neutral"}>
                      {streaming === null || streaming === undefined ? "unknown / unset" : streaming ? "enabled" : "disabled"}
                    </Badge>
                  </td>
                  <td className="dim" style={{ fontSize: 12 }}>
                    Writes <code>appConfig/streaming.enabled</code>. Builds with EXPO_PUBLIC_ENABLE_STREAMING=1 may still stay on until binary override.
                  </td>
                  <td>
                    <div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                      <button className="btn tiny" disabled={busy || streaming === true || !canKill} title={!canKill ? "Owner-only" : undefined} onClick={() => setStreaming(true)}>Enable</button>
                      <button className="btn danger tiny" disabled={busy || streaming === false || !canKill} title={!canKill ? "Owner-only" : undefined} onClick={() => setStreaming(false)}>Kill</button>
                    </div>
                  </td>
                </tr>
                <tr>
                  <td>Marble race (env)</td>
                  <td>
                    <Badge kind={res.data.envReadOnly?.liveMarbleRaceEnabled ? "ok" : "neutral"}>
                      {res.data.envReadOnly?.liveMarbleRaceEnabled ? "on" : "off / unset"}
                    </Badge>
                  </td>
                  <td className="dim" style={{ fontSize: 12 }}>LIVE_MARBLE_RACE_ENABLED — read-only</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
          <div className="dim" style={{ fontSize: 11 }}>Generated {fmtRelative(res.data.generatedAt)}</div>
        </>
      )}
    </div>
  );
}

function FeatureFlags() {
  const toast = useToast();
  const { can } = useAuth();
  const canFlags = can("config.flags.write");
  const res = useAsync<{ flags: Record<string, boolean> }>(() => api.get("/admin/config/flags"), []);
  const [draft, setDraft] = useState<Record<string, boolean> | null>(null);
  const [newFlag, setNewFlag] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const flags = draft ?? res.data?.flags ?? {};

  function addFlag() {
    const key = newFlag.trim().replace(/\s+/g, "_");
    if (!key || key in flags) return;
    setDraft({ ...flags, [key]: false });
    setNewFlag("");
  }

  async function save() {
    if (!canFlags) {
      toast.push("Missing config.flags.write", "err");
      return;
    }
    if (!window.confirm("Save feature flags? Change is audited.")) return;
    setBusy(true);
    setErr(null);
    try {
      await api.post("/admin/config/flags", { flags });
      setDraft(null);
      toast.push("Feature flags saved", "ok");
      res.reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      toast.push(msg, "err");
    } finally {
      setBusy(false);
    }
  }

  const keys = Object.keys(flags).sort();

  return (
    <div className="card stack">
      <h3 className="panel-title">Feature flags</h3>
      <InfoNote>Stored in Postgres <code>admin_config</code>. Every save writes an audit row.</InfoNote>
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
      {err && <ErrorNote>{err}</ErrorNote>}
      <button className="btn" disabled={busy || !canFlags} title={!canFlags ? "Missing permission" : undefined} onClick={save}>{busy ? "Saving…" : "Save flags"}</button>
    </div>
  );
}

function Catalog() {
  const toast = useToast();
  const res = useAsync<CatalogResponse>(() => api.get<CatalogResponse>("/admin/config/catalog"), []);
  const [busy, setBusy] = useState<string | null>(null);

  async function toggle(giftId: string, enabled: boolean) {
    if (!window.confirm(`${enabled ? "Enable" : "Disable"} gift ${giftId}? Audited.`)) return;
    setBusy(giftId);
    try {
      await api.post(`/admin/config/gift/${encodeURIComponent(giftId)}`, { enabled });
      toast.push(`Gift ${enabled ? "enabled" : "disabled"}`, "ok");
      res.reload();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : String(e), "err");
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
        {res.data?.degraded && <WarnNote>Catalog partially degraded — some tables missing.</WarnNote>}
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
                      <td style={{ textAlign: "right" }}>{fmtNum(g.coinCost)}</td>
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

function VersionPolicy() {
  const toast = useToast();
  const { can } = useAuth();
  const canVersion = can("config.version.write");
  const res = useAsync<{ policy: AppVersionPolicy }>(() => api.get("/admin/config/app-version-policy"), []);
  const [enabled, setEnabled] = useState(false);
  const [minCode, setMinCode] = useState("");
  const [message, setMessage] = useState("");
  const [storeUrl, setStoreUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hydratedFrom, setHydratedFrom] = useState<AppVersionPolicy | null>(null);

  const p = res.data?.policy;
  if (p && p !== hydratedFrom) {
    setHydratedFrom(p);
    setEnabled(Boolean(p.enabled));
    setMinCode(p.minimumAndroidVersionCode != null ? String(p.minimumAndroidVersionCode) : "");
    setMessage(p.message || "");
    setStoreUrl(p.storeUrl || "");
  }

  async function save() {
    if (!canVersion) {
      toast.push("Missing config.version.write", "err");
      return;
    }
    if (!window.confirm("Update app version policy? Audited + affects force-update.")) return;
    setBusy(true);
    setErr(null);
    try {
      await api.post("/admin/config/app-version-policy", {
        enabled,
        minimumAndroidVersionCode: minCode.trim() ? Number(minCode) : null,
        message: message.trim() || undefined,
        storeUrl: storeUrl.trim() || undefined,
      });
      toast.push("App version policy saved", "ok");
      res.reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      toast.push(msg, "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card stack">
      <div className="row spread">
        <h3 className="panel-title" style={{ margin: 0 }}>App version policy</h3>
        <button className="btn ghost tiny" onClick={() => res.reload()}>Refresh</button>
      </div>
      {res.loading && <Spinner />}
      {res.error && <ErrorNote>{res.error}</ErrorNote>}
      <label className="row" style={{ gap: 8, margin: 0 }}>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} style={{ width: 18, height: 18 }} />
        <span>Force-update enforcement enabled</span>
      </label>
      <div>
        <label>Minimum Android version code</label>
        <input value={minCode} onChange={(e) => setMinCode(e.target.value)} placeholder="e.g. 120" />
      </div>
      <div>
        <label>Message</label>
        <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Please update Blyp to continue" />
      </div>
      <div>
        <label>Store URL</label>
        <input value={storeUrl} onChange={(e) => setStoreUrl(e.target.value)} placeholder="https://play.google.com/…" />
      </div>
      {err && <ErrorNote>{err}</ErrorNote>}
      <button className="btn" disabled={busy || !canVersion} title={!canVersion ? "Missing permission" : undefined} onClick={save}>{busy ? "Saving…" : "Save version policy"}</button>
    </div>
  );
}

type AutoModPolicy = {
  autoHideThreshold?: number;
  criticalHideReporters?: number;
  seriousHideReports?: number;
  visionFailClosed?: boolean;
  notes?: string | null;
  liveEffect?: { cloudFunctions?: string };
};

function AutoModPolicyEditor() {
  const toast = useToast();
  const { can } = useAuth();
  const canWrite = can("config.flags.write");
  const res = useAsync<{ policy: AutoModPolicy }>(() => api.get("/admin/config/auto-mod"), []);
  const [autoHide, setAutoHide] = useState("3");
  const [critical, setCritical] = useState("2");
  const [serious, setSerious] = useState("2");
  const [visionFail, setVisionFail] = useState(true);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [hydratedFrom, setHydratedFrom] = useState<AutoModPolicy | null>(null);

  const p = res.data?.policy;
  if (p && p !== hydratedFrom) {
    setHydratedFrom(p);
    setAutoHide(String(p.autoHideThreshold ?? 3));
    setCritical(String(p.criticalHideReporters ?? 2));
    setSerious(String(p.seriousHideReports ?? 2));
    setVisionFail(p.visionFailClosed !== false);
    setNotes(p.notes || "");
  }

  async function save() {
    if (!canWrite) {
      toast.push("Missing config.flags.write", "err");
      return;
    }
    if (!window.confirm("Save auto-mod policy? Audited. Mirrors to Firestore appConfig/autoModPolicy.")) return;
    setBusy(true);
    try {
      await api.post("/admin/config/auto-mod", {
        autoHideThreshold: Number(autoHide),
        criticalHideReporters: Number(critical),
        seriousHideReports: Number(serious),
        visionFailClosed: visionFail,
        notes: notes.trim() || null,
      });
      toast.push("Auto-mod policy saved", "ok");
      res.reload();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : String(e), "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card stack">
      <div className="row spread">
        <h3 className="panel-title" style={{ margin: 0 }}>Auto-mod policy</h3>
        <button className="btn ghost tiny" onClick={() => res.reload()}>Refresh</button>
      </div>
      {res.loading && <Spinner />}
      {res.error && <ErrorNote>{res.error}</ErrorNote>}
      <InfoNote>
        Defaults match Cloud Functions report auto-action (hide at 3 reports; child_safety needs 2 distinct reporters).
        Policy is stored in Postgres + Firestore. Live CF effect requires a functions revision that reads <code>appConfig/autoModPolicy</code>.
      </InfoNote>
      {res.data?.policy?.liveEffect?.cloudFunctions && (
        <p className="dim" style={{ fontSize: 12, margin: 0 }}>{res.data.policy.liveEffect.cloudFunctions}</p>
      )}
      <div className="row wrap" style={{ gap: 10 }}>
        <div>
          <label>Auto-hide threshold</label>
          <input value={autoHide} onChange={(e) => setAutoHide(e.target.value)} style={{ width: 80 }} />
        </div>
        <div>
          <label>Critical hide reporters</label>
          <input value={critical} onChange={(e) => setCritical(e.target.value)} style={{ width: 80 }} />
        </div>
        <div>
          <label>Serious hide reports</label>
          <input value={serious} onChange={(e) => setSerious(e.target.value)} style={{ width: 80 }} />
        </div>
      </div>
      <label className="row" style={{ gap: 8, margin: 0 }}>
        <input type="checkbox" checked={visionFail} onChange={(e) => setVisionFail(e.target.checked)} style={{ width: 18, height: 18 }} />
        <span>Vision fail-closed (policy note — media pipeline may still use its own env)</span>
      </label>
      <div>
        <label>Notes</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="optional" />
      </div>
      <button className="btn" disabled={busy || !canWrite} onClick={save}>{busy ? "Saving…" : "Save auto-mod policy"}</button>
    </div>
  );
}

export default function Config() {
  return (
    <div>
      <PageHeader title="Configuration" subtitle="Kill switches, flags, catalog, and force-update policy" />
      <div className="config-grid">
        <div className="stack">
          <KillSwitchBoard />
          <FeatureFlags />
          <AutoModPolicyEditor />
          <VersionPolicy />
        </div>
        <Catalog />
      </div>
    </div>
  );
}
