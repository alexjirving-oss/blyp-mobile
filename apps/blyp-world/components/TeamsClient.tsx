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
      <div className="px-6 py-16 text-sm text-[var(--blyp-muted)]">
        {session ? "Loading Teams…" : "Loading…"}
      </div>
    );
  }

  if (session && team && view === "desk") {
    return (
      <div>
        <div className="border-b border-[var(--blyp-line)] px-5 py-3 text-center text-sm md:px-8">
          <button
            type="button"
            onClick={() => setView("marketing")}
            className="font-semibold text-[var(--blyp-teal)]"
          >
            How Teams works & apply →
          </button>
        </div>
        {error ? (
          <p className="px-5 pt-4 text-center text-sm text-[var(--blyp-rose)]">
            {error}{" "}
            <button
              type="button"
              className="font-semibold underline"
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
    <div>
      {session && team ? (
        <div className="border-b border-[var(--blyp-line)] px-5 py-3 text-center text-sm md:px-8">
          <button
            type="button"
            onClick={() => setView("desk")}
            className="font-semibold text-[var(--blyp-teal)]"
          >
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
      <TeamsMarketing showDashboardLink={!!(session && team)} />
    </div>
  );
}
