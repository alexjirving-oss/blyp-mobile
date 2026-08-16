"use client";

import { useMemo, useState } from "react";
import { ensureFirebaseFromCognito } from "@/lib/firebaseBridge";
import {
  teamDeepLink,
  teamInviteUrl,
  type TeamBundle,
  type TeamMember,
} from "@/lib/teams";
import { welcomeAfterAccept } from "@/lib/teamShareCopy";
import { useAuth } from "../AuthProvider";
import {
  Avatar,
  deskTabsForRole,
  exportRosterCsv,
  type DeskTabId,
} from "./deskUi";
import { DeskOverview } from "./panels/DeskOverview";
import { DeskRoster } from "./panels/DeskRoster";
import { DeskBattles } from "./panels/DeskBattles";
import { DeskLinks } from "./panels/DeskLinks";
import { DeskBoards } from "./panels/DeskBoards";
import { DeskRecruit } from "./panels/DeskRecruit";

export function TeamDashboard({
  team,
  onRefresh,
  busy,
  preview = false,
}: {
  team: TeamBundle;
  onRefresh: () => void;
  busy: boolean;
  preview?: boolean;
}) {
  const { session, requireAuth } = useAuth();
  const [toast, setToast] = useState<string | null>(null);
  const tabs = useMemo(() => deskTabsForRole(team.isLeader), [team.isLeader]);
  const [tab, setTab] = useState<DeskTabId>("overview");

  // If role flips (preview toggle), keep tab valid
  const activeTab = tabs.some((t) => t.id === tab) ? tab : "overview";

  const inviteUrl = teamInviteUrl(team);
  const deep = teamDeepLink(team.teamId);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  };

  const withAuth = async (fn: () => Promise<void>) => {
    if (preview) {
      showToast("Preview only — sign in on your live desk to act");
      return;
    }
    if (!session || requireAuth()) return;
    try {
      await ensureFirebaseFromCognito({
        cognitoIdToken: session.idToken,
        uid: session.sub,
      });
      await fn();
      onRefresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Action failed");
    }
  };

  const copyWelcomeFor = async (m: TeamMember) => {
    const text = welcomeAfterAccept(
      {
        teamName: team.name,
        inviteUrl,
        leaderName: team.leaderName,
      },
      m.displayName,
    );
    try {
      await navigator.clipboard.writeText(text);
      showToast(`Welcome copied for ${m.displayName}`);
    } catch {
      showToast("Couldn’t copy welcome");
    }
  };

  return (
    <div
      id="dashboard"
      data-teams-desk={preview ? "preview" : "live"}
      data-teams-role={team.isLeader ? "boss" : "member"}
      className="mx-auto max-w-6xl px-4 py-6 pb-24 md:px-6"
    >
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--blyp-line)] pb-5">
        <div className="flex min-w-0 items-start gap-3">
          <Avatar name={team.name} photoURL={team.crestUrl} size={52} />
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--blyp-teal)]">
              {team.isLeader ? "Teams desk · Boss" : "Teams desk · Member"}
            </p>
            <h1 className="font-display mt-1 truncate text-3xl font-bold tracking-tight md:text-4xl">
              {team.name}
            </h1>
            <p className="mt-1 text-sm text-[var(--blyp-muted)]">
              Led by {team.leaderName} · {team.memberCount}{" "}
              {team.memberCount === 1 ? "member" : "members"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {team.isLeader ? (
            <button
              type="button"
              onClick={() => setTab("recruit")}
              className="rounded-lg bg-[var(--blyp-teal)] px-3.5 py-2 text-xs font-bold text-[var(--blyp-ink)]"
            >
              Invite hosts
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setTab("battles")}
              className="rounded-lg bg-[var(--blyp-teal)] px-3.5 py-2 text-xs font-bold text-[var(--blyp-ink)]"
            >
              Open Battles
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              exportRosterCsv(team);
              showToast("Roster CSV downloaded");
            }}
            className="rounded-lg border border-[var(--blyp-line)] px-3.5 py-2 text-xs font-semibold"
          >
            Export CSV
          </button>
          {!preview ? (
            <button
              type="button"
              onClick={() => void onRefresh()}
              disabled={busy}
              className="rounded-lg border border-[var(--blyp-line)] px-3.5 py-2 text-xs font-semibold disabled:opacity-50"
            >
              Refresh
            </button>
          ) : null}
        </div>
      </header>

      <nav
        className="mt-4 flex gap-1 overflow-x-auto border-b border-[var(--blyp-line)] pb-px"
        aria-label="Teams desk sections"
      >
        {tabs.map((t) => {
          const on = activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`shrink-0 border-b-2 px-3.5 py-2.5 text-xs font-bold tracking-wide transition-colors ${
                on
                  ? "border-[var(--blyp-teal)] text-[var(--blyp-teal)]"
                  : "border-transparent text-[var(--blyp-muted)] hover:text-[var(--blyp-fog)]"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      <div className="mt-6">
        {activeTab === "overview" ? (
          <DeskOverview
            team={team}
            preview={preview}
            inviteUrl={inviteUrl}
            onToast={showToast}
            onGoTab={(id) => setTab(id as DeskTabId)}
          />
        ) : null}
        {activeTab === "roster" ? (
          <DeskRoster
            team={team}
            preview={preview}
            inviteUrl={inviteUrl}
            sessionSub={session?.sub}
            sessionToken={session?.idToken}
            withAuth={withAuth}
            onToast={showToast}
            onCopyWelcome={copyWelcomeFor}
          />
        ) : null}
        {activeTab === "battles" ? (
          <DeskBattles
            team={team}
            preview={preview}
            sessionSub={session?.sub}
            sessionToken={session?.idToken}
            withAuth={withAuth}
            onToast={showToast}
          />
        ) : null}
        {activeTab === "links" ? (
          <DeskLinks
            team={team}
            preview={preview}
            sessionSub={session?.sub}
            sessionToken={session?.idToken}
            withAuth={withAuth}
            onToast={showToast}
          />
        ) : null}
        {activeTab === "boards" ? <DeskBoards team={team} /> : null}
        {activeTab === "recruit" ? (
          <DeskRecruit
            team={team}
            preview={preview}
            inviteUrl={inviteUrl}
            deepLink={deep}
            session={
              session
                ? { sub: session.sub, idToken: session.idToken }
                : null
            }
            onRefresh={onRefresh}
            onToast={showToast}
          />
        ) : null}
      </div>

      {toast ? (
        <div className="fixed bottom-20 left-1/2 z-40 -translate-x-1/2 rounded-full bg-[var(--blyp-teal)] px-4 py-2 text-sm font-semibold text-[var(--blyp-ink)] md:bottom-8">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
