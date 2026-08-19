"use client";

import { useCallback, useEffect, useState } from "react";
import { ensureFirebaseFromCognito } from "@/lib/firebaseBridge";
import { getFirebaseAuth } from "@/lib/firebase";
import {
  loadMyTeam,
  loadMyTeamViaApi,
  loadTeamApplicationStatus,
  type TeamApplicationStatus,
  type TeamBundle,
} from "@/lib/teams";
import { useAuth } from "./AuthProvider";
import { TeamDashboard } from "./teams/TeamDashboard";
import {
  ApplicationStatusBanner,
  TeamsMarketing,
} from "./teams/TeamsMarketing";
import "./hub-neon.css";

function friendlyTeamsError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err || "");
  const lower = raw.toLowerCase();
  if (
    lower.includes("missing or insufficient permissions") ||
    lower.includes("permission-denied") ||
    lower.includes("permission_denied")
  ) {
    return "Couldn’t open your team yet — reconnecting your session. Tap Retry.";
  }
  return raw || "Could not load team";
}

export function TeamsClient() {
  const { session, loading } = useAuth();
  const [team, setTeam] = useState<TeamBundle | null>(null);
  const [application, setApplication] = useState<TeamApplicationStatus | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"marketing" | "desk">("marketing");

  const refresh = useCallback(async () => {
    if (!session?.sub || !session.idToken) {
      setTeam(null);
      setApplication(null);
      setLoaded(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const bridged = await ensureFirebaseFromCognito({
        cognitoIdToken: session.idToken,
        uid: session.sub,
      });
      const firebaseUid = getFirebaseAuth().currentUser?.uid;

      let appStatus: TeamApplicationStatus | null = null;
      if (bridged && firebaseUid === session.sub) {
        try {
          appStatus = await loadTeamApplicationStatus(session.sub);
        } catch {
          appStatus = null;
        }
      }
      setApplication(appStatus);

      if (bridged && firebaseUid === session.sub) {
        try {
          const bundle = await loadMyTeam(session.sub);
          setTeam(bundle);
          if (bundle) setView("desk");
          return;
        } catch (fsErr) {
          if (typeof console !== "undefined") {
            console.warn(
              "[teams] Firestore load failed, trying API:",
              fsErr instanceof Error ? fsErr.message : fsErr,
            );
          }
        }
      }

      const viaApi = await loadMyTeamViaApi(session.idToken);
      setTeam(viaApi);
      if (viaApi) setView("desk");
    } catch (e) {
      setError(friendlyTeamsError(e));
      setTeam(null);
    } finally {
      setBusy(false);
      setLoaded(true);
    }
  }, [session?.sub, session?.idToken]);

  useEffect(() => {
    if (loading) return;
    setLoaded(false);
    void refresh();
  }, [loading, refresh]);

  if (loading || (session && !loaded && !error)) {
    return (
      <div className="hub hub-wide">
        <p className="hub-kicker">Teams</p>
        <h1 className="hub-title">Teams</h1>
        <p className="hub-load">
          {session ? "Loading your desk…" : "Loading…"}
        </p>
      </div>
    );
  }

  if (session && team && view === "desk") {
    return (
      <div className="hub hub-wide" style={{ paddingTop: 0, maxWidth: "none" }}>
        <div className="hub-desk-nav">
          <button type="button" onClick={() => setView("marketing")}>
            How Teams works & apply →
          </button>
        </div>
        {error ? (
          <p className="hub-err" style={{ textAlign: "center", padding: "0 1rem" }}>
            {error}{" "}
            <button
              type="button"
              className="hub-ghost"
              style={{ minHeight: "1.8rem", padding: "0 0.7rem" }}
              onClick={() => void refresh()}
            >
              Retry
            </button>
          </p>
        ) : null}
        <TeamDashboard team={team} onRefresh={refresh} busy={busy} />
      </div>
    );
  }

  return (
    <div className="hub hub-wide" style={{ paddingTop: 0, maxWidth: "none" }}>
      {session && team ? (
        <div className="hub-desk-nav">
          <button type="button" onClick={() => setView("desk")}>
            ← Back to your team desk
          </button>
        </div>
      ) : null}
      {session && !team && application ? (
        <ApplicationStatusBanner
          status={application.status}
          teamName={application.teamName}
        />
      ) : null}
      {session && !team && !application && !error ? (
        <div className="hub-banner is-wait">
          You’re not on a team yet. Apply below, or wait for a host invite —
          this page does not invent a roster.
        </div>
      ) : null}
      {error ? (
        <p className="hub-err" style={{ textAlign: "center", padding: "0.75rem 1rem 0" }}>
          {error}{" "}
          <button
            type="button"
            className="hub-ghost"
            style={{ minHeight: "1.8rem", padding: "0 0.7rem" }}
            onClick={() => void refresh()}
          >
            Retry
          </button>
        </p>
      ) : null}
      <TeamsMarketing showDashboardLink={!!(session && team)} />
    </div>
  );
}
