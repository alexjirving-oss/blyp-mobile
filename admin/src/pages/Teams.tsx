import { useState } from "react";
import { api } from "../api/client";
import { useAsync } from "../lib/useAsync";
import { fmtRelative } from "../lib/format";
import { PageHeader, Spinner, ErrorNote, Badge, EmptyState } from "../components/ui";
import type { TeamApplicationsResponse, TeamsResponse } from "../types";

export default function Teams() {
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const teams = useAsync<TeamsResponse>(() => api.get<TeamsResponse>("/admin/teams"), []);
  const apps = useAsync<TeamApplicationsResponse>(
    () => api.get<TeamApplicationsResponse>("/admin/team-applications"),
    []
  );

  const reloadAll = () => {
    setActionError(null);
    teams.reload();
    apps.reload();
  };

  const approve = async (uid: string) => {
    const teamName = window.prompt("Team name (optional):", "") || "";
    setBusyUid(uid);
    setActionError(null);
    try {
      await api.post(`/admin/team-applications/${encodeURIComponent(uid)}/approve`, {
        teamName: teamName || undefined,
      });
      reloadAll();
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyUid(null);
    }
  };

  const reject = async (uid: string) => {
    const reason = window.prompt("Rejection reason (optional):", "") || "";
    setBusyUid(uid);
    setActionError(null);
    try {
      await api.post(`/admin/team-applications/${encodeURIComponent(uid)}/reject`, {
        reason: reason || undefined,
      });
      reloadAll();
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyUid(null);
    }
  };

  const teamItems = teams.data?.items ?? [];
  const appItems = apps.data?.items ?? [];
  const pendingCount = apps.data?.pendingCount ?? 0;

  return (
    <div>
      <PageHeader
        title="Teams"
        subtitle="Active creator teams and applications to run a team"
        actions={
          <div className="row" style={{ gap: 8 }}>
            {pendingCount > 0 && <Badge kind="warn">{pendingCount} pending</Badge>}
            <button className="btn ghost tiny" onClick={reloadAll}>
              Refresh
            </button>
          </div>
        }
      />

      {actionError && (
        <div style={{ marginBottom: 14 }}>
          <ErrorNote>{actionError}</ErrorNote>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 className="panel-title">Active teams</h3>
        {teams.loading && <Spinner />}
        {teams.error && <ErrorNote>{teams.error}</ErrorNote>}
        {teams.data?.degraded && (
          <ErrorNote>{teams.data.detail || "Teams data unavailable"}</ErrorNote>
        )}
        {!teams.loading && !teams.error && teamItems.length === 0 && (
          <EmptyState>No teams yet.</EmptyState>
        )}
        {teamItems.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Team</th>
                  <th>Leader</th>
                  <th>Members</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {teamItems.map((t) => (
                  <tr key={t.teamId}>
                    <td>
                      <strong>{t.name || t.teamId}</strong>
                      <div className="dim mono" style={{ fontSize: 11, marginTop: 2 }}>
                        {t.teamId}
                      </div>
                    </td>
                    <td>{t.leaderName || t.leaderId || "—"}</td>
                    <td>{t.memberCount ?? 0}</td>
                    <td>{t.createdAt ? fmtRelative(t.createdAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h3 className="panel-title">Team applications</h3>
        {apps.loading && <Spinner />}
        {apps.error && <ErrorNote>{apps.error}</ErrorNote>}
        {apps.data?.degraded && (
          <ErrorNote>{apps.data.detail || "Applications unavailable"}</ErrorNote>
        )}
        {!apps.loading && !apps.error && appItems.length === 0 && (
          <EmptyState>No applications yet.</EmptyState>
        )}
        {appItems.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Applicant</th>
                  <th>Pitch</th>
                  <th>Status</th>
                  <th>Submitted</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {appItems.map((a) => {
                  const pending = a.status === "pending";
                  const busy = busyUid === a.uid;
                  return (
                    <tr key={a.uid}>
                      <td>
                        <strong>{a.displayName || a.uid}</strong>
                        <div className="dim mono" style={{ fontSize: 11, marginTop: 2 }}>
                          {a.uid}
                        </div>
                      </td>
                      <td style={{ maxWidth: 320 }}>{(a.pitch || "").slice(0, 180) || "—"}</td>
                      <td>
                        <Badge kind={pending ? "warn" : a.status === "approved" ? "ok" : "neutral"}>
                          {a.status || "pending"}
                        </Badge>
                      </td>
                      <td>{a.createdAt ? fmtRelative(a.createdAt) : "—"}</td>
                      <td>
                        {pending ? (
                          <div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                            <button
                              className="btn tiny"
                              disabled={busy}
                              onClick={() => approve(a.uid)}
                            >
                              Approve
                            </button>
                            <button
                              className="btn ghost tiny"
                              disabled={busy}
                              onClick={() => reject(a.uid)}
                            >
                              Reject
                            </button>
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
