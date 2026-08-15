import { useState } from "react";
import { useAuth } from "../auth/useAuth";
import { api, ApiError } from "../api/client";
import { ADMIN_ROLES, ROLE_DISPLAY, type AdminRole } from "../auth/permissions";
import { fmtDate } from "../lib/format";
import { PageHeader, Badge, WarnNote, Spinner, ErrorNote, EmptyState, InfoNote } from "../components/ui";
import { useToast } from "../components/Toast";
import AuditFeed from "../components/AuditFeed";
import { useAsync } from "../lib/useAsync";

type StaffItem = {
  sub: string;
  role: AdminRole;
  displayName: string | null;
  notes: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
  source: string;
};

type StaffResponse = { items: StaffItem[]; roles: string[]; note?: string };

type DsarItem = {
  requestId: string;
  userId: string;
  requestType: string;
  status: string;
  notes: string | null;
  createdBy: string;
  createdAt: string | null;
  hasExportPackage?: boolean;
};

type MassBanPreview = { wouldBan: number; skipped: number };
type MassBanResult = { ok: boolean };
type MassBanResponse = {
  preview?: MassBanPreview;
  results?: MassBanResult[];
};

export default function Access() {
  const { session, me, role, can, refreshMe } = useAuth();
  const toast = useToast();
  const [exporting, setExporting] = useState(false);
  const canManageStaff = can("staff.manage");
  const canExport = can("audit.export");
  const canDsar = can("dsar.manage");
  const canDsarExec = can("dsar.execute");
  const canMassBan = can("users.ban.mass");

  const staff = useAsync<StaffResponse>(
    () => (canManageStaff ? api.get<StaffResponse>("/admin/staff") : Promise.resolve({ items: [], roles: [...ADMIN_ROLES] })),
    [canManageStaff, me?.role],
  );

  const dsar = useAsync<{ items: DsarItem[]; note?: string }>(
    () => (canDsar ? api.get<{ items: DsarItem[]; note?: string }>("/admin/dsar") : Promise.resolve({ items: [] })),
    [canDsar, me?.role],
  );

  const [newSub, setNewSub] = useState("");
  const [newRole, setNewRole] = useState<AdminRole>("analyst_readonly");
  const [newName, setNewName] = useState("");
  const [dsarUser, setDsarUser] = useState("");
  const [dsarType, setDsarType] = useState("export");
  const [dsarNotes, setDsarNotes] = useState("");
  const [massBanText, setMassBanText] = useState("");
  const [massBanReason, setMassBanReason] = useState("");
  const [massPreview, setMassPreview] = useState<MassBanResponse | null>(null);
  const [busy, setBusy] = useState(false);

  async function exportCsv() {
    if (!canExport) {
      toast.push("Missing audit.export permission", "err");
      return;
    }
    setExporting(true);
    try {
      await api.download("/admin/audit.csv?limit=500", `blyp-admin-audit-${Date.now()}.csv`);
      toast.push("Audit CSV downloaded", "ok");
    } catch (e) {
      toast.push(e instanceof ApiError ? e.message : String(e), "err");
    } finally {
      setExporting(false);
    }
  }

  async function saveStaff() {
    if (!canManageStaff) return;
    setBusy(true);
    try {
      await api.post("/admin/staff", {
        sub: newSub.trim(),
        role: newRole,
        displayName: newName.trim() || null,
      });
      toast.push("Role saved", "ok");
      setNewSub("");
      setNewName("");
      staff.reload();
      await refreshMe();
    } catch (e) {
      toast.push(e instanceof ApiError ? e.message : String(e), "err");
    } finally {
      setBusy(false);
    }
  }

  async function removeStaff(sub: string) {
    if (!canManageStaff) return;
    if (!window.confirm(`Remove console role for ${sub}? (Allowlist env is unchanged.)`)) return;
    setBusy(true);
    try {
      await api.post(`/admin/staff/${encodeURIComponent(sub)}/delete`, {});
      toast.push("Role removed", "ok");
      staff.reload();
    } catch (e) {
      toast.push(e instanceof ApiError ? e.message : String(e), "err");
    } finally {
      setBusy(false);
    }
  }

  async function createDsar() {
    if (!canDsar) return;
    setBusy(true);
    try {
      await api.post("/admin/dsar", {
        userId: dsarUser.trim(),
        requestType: dsarType,
        notes: dsarNotes.trim() || null,
      });
      toast.push("DSAR request queued", "ok");
      setDsarUser("");
      setDsarNotes("");
      dsar.reload();
    } catch (e) {
      toast.push(e instanceof ApiError ? e.message : String(e), "err");
    } finally {
      setBusy(false);
    }
  }

  async function exportDsarPackage(requestId: string) {
    if (!canDsar) return;
    setBusy(true);
    try {
      await api.post(`/admin/dsar/${encodeURIComponent(requestId)}/export-package`, {});
      toast.push("Export package generated", "ok");
      dsar.reload();
    } catch (e) {
      toast.push(e instanceof ApiError ? e.message : String(e), "err");
    } finally {
      setBusy(false);
    }
  }

  async function purgeDsar(r: DsarItem) {
    if (!canDsarExec) {
      toast.push("Owner-only: missing dsar.execute", "err");
      return;
    }
    if (r.requestType !== "delete") {
      toast.push("Purge only for requestType=delete", "err");
      return;
    }
    if (!r.hasExportPackage && r.status !== "package_ready") {
      toast.push("Generate export package first", "err");
      return;
    }
    if (!window.confirm(`Purge economy personal tables for ${r.userId}? Export-first required. Ledger retained.`)) return;
    const phrase = window.prompt('Type PURGE to confirm hard-delete of personal economy tables:');
    if (phrase !== "PURGE") {
      toast.push("Aborted — confirm phrase mismatch", "err");
      return;
    }
    const confirmUser = window.prompt("Re-enter subject Cognito sub to confirm:");
    if (confirmUser !== r.userId) {
      toast.push("Aborted — user id mismatch", "err");
      return;
    }
    setBusy(true);
    try {
      await api.post(`/admin/dsar/${encodeURIComponent(r.requestId)}/purge`, {
        confirmPhrase: "PURGE",
        confirmUserId: r.userId,
      });
      toast.push("DSAR purge completed (economy personal tables)", "ok");
      dsar.reload();
    } catch (e) {
      toast.push(e instanceof ApiError ? e.message : String(e), "err");
    } finally {
      setBusy(false);
    }
  }

  async function dryRunMassBan() {
    if (!canMassBan) return;
    const userIds = massBanText
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    setBusy(true);
    try {
      const out = await api.post<MassBanResponse>("/admin/users/mass-ban", {
        userIds,
        reason: massBanReason.trim() || "mass ban",
        dryRun: true,
      });
      setMassPreview(out);
      toast.push(`Dry-run: would ban ${out.preview?.wouldBan ?? 0}`, "ok");
    } catch (e) {
      toast.push(e instanceof ApiError ? e.message : String(e), "err");
    } finally {
      setBusy(false);
    }
  }

  async function executeMassBan() {
    if (!canMassBan) return;
    const userIds = massBanText
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!window.confirm(`Execute mass ban on up to ${userIds.length} users? This is irreversible without unban.`)) return;
    const phrase = window.prompt('Type MASS BAN to confirm:');
    if (phrase !== "MASS BAN") {
      toast.push("Aborted — confirm phrase mismatch", "err");
      return;
    }
    setBusy(true);
    try {
      const out = await api.post<MassBanResponse>("/admin/users/mass-ban", {
        userIds,
        reason: massBanReason.trim(),
        dryRun: false,
        confirmPhrase: "MASS BAN",
      });
      setMassPreview(out);
      toast.push("Mass ban executed (audited)", "ok");
    } catch (e) {
      toast.push(e instanceof ApiError ? e.message : String(e), "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Access & Security"
        subtitle="RBAC roles, DSAR intake, allowlist gate, and audit trail"
        actions={
          <button className="btn tiny" disabled={exporting || !canExport} onClick={exportCsv} title={!canExport ? "Missing audit.export" : undefined}>
            {exporting ? "Exporting…" : "Export audit CSV"}
          </button>
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 18 }}>
        <div className="card">
          <h3 className="panel-title">Current session</h3>
          <div className="row spread" style={{ marginBottom: 8 }}>
            <span className="muted" style={{ fontSize: 13 }}>Signed in as (Cognito sub)</span>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{session?.actorUserId}</span>
          </div>
          <div className="row spread" style={{ marginBottom: 8 }}>
            <span className="muted" style={{ fontSize: 13 }}>Console role</span>
            <Badge kind="info">{me?.roleDisplay || role || "…"}</Badge>
          </div>
          <div className="row spread" style={{ marginBottom: 8 }}>
            <span className="muted" style={{ fontSize: 13 }}>Auth</span>
            <Badge kind="info">Cognito + allowlist + RBAC</Badge>
          </div>
          <div className="row spread">
            <span className="muted" style={{ fontSize: 13 }}>Token expires</span>
            <span style={{ fontSize: 13 }}>{fmtDate(session ? new Date(session.expiresAt).toISOString() : null)}</span>
          </div>
          {me?.permissions && (
            <p className="dim" style={{ fontSize: 11, marginTop: 12, marginBottom: 0 }}>
              {me.permissions.length} permissions · source {me.staffSource || "—"}
            </p>
          )}
          <WarnNote>
            Session revoke / remote logout and step-up MFA for Owner crossroads are not implemented yet. Cognito token expiry is the current session bound. Treat stolen admin tokens as high severity — rotate Cognito password + revoke refresh via AWS console if needed.
          </WarnNote>
          <InfoNote>
            Client <code>isAdmin</code> / <code>roles</code> writes are already frozen in Firestore rules (<code>userPrivFieldsFrozenOn*</code>). Cloud Run allowlist + RBAC remain authoritative for console APIs.
          </InfoNote>
        </div>
        <div className="card">
          <h3 className="panel-title">How admin access works</h3>
          <ul style={{ margin: 0, paddingLeft: 18, color: "var(--text-2)", fontSize: 13, lineHeight: 1.8 }}>
            <li>Outer gate: <code>ADMIN_ALLOWLIST_SUBS</code> on Cloud Run</li>
            <li>Inner gate: Postgres <code>admin_staff</code> role + <code>requirePermission()</code></li>
            <li>Allowlisted without a role → denied (prefer deny)</li>
            <li>Owner-only: role grants, global kills, live Stripe withdraw approve, mass actions, DSAR purge</li>
            <li>In-app mobile admin role is separate (capabilities sync); not authoritative for Cloud Run</li>
          </ul>
        </div>
      </div>

      {canManageStaff ? (
        <div className="card" style={{ marginBottom: 18 }}>
          <h3 className="panel-title">Staff roles (Owner)</h3>
          <InfoNote>
            Assigning a role here does <strong>not</strong> add Cognito subs to <code>ADMIN_ALLOWLIST_SUBS</code>. Both gates are required.
          </InfoNote>
          {staff.loading && <Spinner />}
          {staff.error && <ErrorNote>{staff.error}</ErrorNote>}
          <div className="row wrap" style={{ gap: 10, marginTop: 12 }}>
            <div className="grow">
              <label>Cognito sub</label>
              <input value={newSub} onChange={(e) => setNewSub(e.target.value)} placeholder="uuid sub" />
            </div>
            <div>
              <label>Role</label>
              <select value={newRole} onChange={(e) => setNewRole(e.target.value as AdminRole)}>
                {ADMIN_ROLES.map((r) => (
                  <option key={r} value={r}>{ROLE_DISPLAY[r]}</option>
                ))}
              </select>
            </div>
            <div className="grow">
              <label>Display name</label>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="optional" />
            </div>
            <div style={{ alignSelf: "end" }}>
              <button className="btn" disabled={busy || !newSub.trim()} onClick={saveStaff}>Save role</button>
            </div>
          </div>
          {staff.data && staff.data.items.length === 0 && <EmptyState>No staff rows yet.</EmptyState>}
          {staff.data && staff.data.items.length > 0 && (
            <div style={{ overflowX: "auto", marginTop: 14 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr className="dim" style={{ textAlign: "left" }}>
                    <th style={{ padding: 6 }}>Sub</th>
                    <th style={{ padding: 6 }}>Name</th>
                    <th style={{ padding: 6 }}>Role</th>
                    <th style={{ padding: 6 }}>Source</th>
                    <th style={{ padding: 6 }} />
                  </tr>
                </thead>
                <tbody>
                  {staff.data.items.map((row) => (
                    <tr key={row.sub} style={{ borderTop: "1px solid var(--border)" }}>
                      <td className="mono" style={{ padding: 6, fontSize: 11 }}>{row.sub}</td>
                      <td style={{ padding: 6 }}>{row.displayName || "—"}</td>
                      <td style={{ padding: 6 }}><Badge kind="info">{ROLE_DISPLAY[row.role] || row.role}</Badge></td>
                      <td style={{ padding: 6 }} className="dim">{row.source}</td>
                      <td style={{ padding: 6 }}>
                        <button className="btn ghost tiny" disabled={busy || row.role === "owner"} onClick={() => removeStaff(row.sub)}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="card" style={{ marginBottom: 18 }}>
          <WarnNote>Role assignment is Owner-only. Your effective role: {me?.roleDisplay || role || "unknown"}.</WarnNote>
        </div>
      )}

      {canMassBan && (
        <div className="card" style={{ marginBottom: 18 }}>
          <h3 className="panel-title">Mass ban (Owner)</h3>
          <WarnNote>
            Cap {25} subs per batch. Always dry-run first. Execute requires typing <code>MASS BAN</code>. Audited; no silent mass actions.
          </WarnNote>
          <div>
            <label>Cognito subs (whitespace / comma separated)</label>
            <textarea rows={3} value={massBanText} onChange={(e) => setMassBanText(e.target.value)} placeholder="uuid&#10;uuid" />
          </div>
          <div>
            <label>Reason (required for execute)</label>
            <input value={massBanReason} onChange={(e) => setMassBanReason(e.target.value)} placeholder="Incident / coordinated abuse" />
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn ghost" disabled={busy || !massBanText.trim()} onClick={dryRunMassBan}>Dry-run preview</button>
            <button className="btn danger" disabled={busy || !massBanText.trim() || !massBanReason.trim()} onClick={executeMassBan}>Execute mass ban</button>
          </div>
          {massPreview?.preview && (
            <p className="dim" style={{ fontSize: 12 }}>
              Preview: wouldBan={massPreview.preview.wouldBan} skipped={massPreview.preview.skipped}
              {massPreview.results ? ` · executed=${massPreview.results.filter((x) => x.ok).length}` : ""}
            </p>
          )}
        </div>
      )}

      {canDsar && (
        <div className="card" style={{ marginBottom: 18 }}>
          <h3 className="panel-title">DSAR / data export queue</h3>
          <p className="dim" style={{ fontSize: 12.5, marginTop: 0 }}>{dsar.data?.note || "Export-first. Hard-delete is Owner-only."}</p>
          <div className="row wrap" style={{ gap: 10 }}>
            <div className="grow">
              <label>User sub</label>
              <input value={dsarUser} onChange={(e) => setDsarUser(e.target.value)} placeholder="Cognito sub" />
            </div>
            <div>
              <label>Type</label>
              <select value={dsarType} onChange={(e) => setDsarType(e.target.value)}>
                <option value="export">export</option>
                <option value="delete">delete</option>
                <option value="rectify">rectify</option>
              </select>
            </div>
            <div className="grow">
              <label>Notes</label>
              <input value={dsarNotes} onChange={(e) => setDsarNotes(e.target.value)} placeholder="ticket / legal ref" />
            </div>
            <div style={{ alignSelf: "end" }}>
              <button className="btn" disabled={busy || !dsarUser.trim()} onClick={createDsar}>Queue request</button>
            </div>
          </div>
          {dsar.loading && <Spinner />}
          {dsar.error && <ErrorNote>{dsar.error}</ErrorNote>}
          {dsar.data && dsar.data.items.length === 0 && <EmptyState>No open DSAR requests.</EmptyState>}
          {dsar.data && dsar.data.items.length > 0 && (
            <div style={{ overflowX: "auto", marginTop: 12 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr className="dim" style={{ textAlign: "left" }}>
                    <th style={{ padding: 6 }}>Created</th>
                    <th style={{ padding: 6 }}>User</th>
                    <th style={{ padding: 6 }}>Type</th>
                    <th style={{ padding: 6 }}>Status</th>
                    <th style={{ padding: 6 }}>Notes</th>
                    <th style={{ padding: 6 }} />
                  </tr>
                </thead>
                <tbody>
                  {dsar.data.items.map((r) => (
                    <tr key={r.requestId} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: 6 }}>{fmtDate(r.createdAt)}</td>
                      <td className="mono" style={{ padding: 6, fontSize: 11 }}>{r.userId.slice(0, 14)}…</td>
                      <td style={{ padding: 6 }}>{r.requestType}</td>
                      <td style={{ padding: 6 }}>
                        <Badge kind="warn">{r.status}</Badge>
                        {r.hasExportPackage ? <span className="dim" style={{ marginLeft: 6, fontSize: 11 }}>pkg</span> : null}
                      </td>
                      <td style={{ padding: 6 }} className="dim">{r.notes || "—"}</td>
                      <td style={{ padding: 6 }}>
                        <div className="row" style={{ gap: 4 }}>
                          <button className="btn ghost tiny" disabled={busy} onClick={() => exportDsarPackage(r.requestId)}>Export pkg</button>
                          {r.requestType === "delete" && (
                            <button className="btn danger tiny" disabled={busy || !canDsarExec} title={!canDsarExec ? "Owner only" : undefined} onClick={() => purgeDsar(r)}>
                              Purge
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <WarnNote>
          CSV export includes actor/target IDs and action metadata — treat as sensitive ops data. Max 500 rows per download.
        </WarnNote>
      </div>

      <div className="card">
        <h3 className="panel-title">Audit log</h3>
        <p className="muted" style={{ marginTop: -6, fontSize: 12 }}>Every administrative action, newest first. Click a user row to open their profile.</p>
        <AuditFeed />
      </div>
    </div>
  );
}
