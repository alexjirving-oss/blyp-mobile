"use client";

import { useMemo } from "react";
import type { TeamBundle, TeamJoinRequest, TeamMember } from "@/lib/teams";
import {
  acceptJoinRequestWeb,
  rejectJoinRequestWeb,
  removeTeamMemberWeb,
} from "@/lib/teams";
import { HostMessageButtons } from "../ShareRecruitHub";
import {
  Avatar,
  LivePill,
  PersonLine,
  RolePill,
  SectionTitle,
  exportRosterCsv,
  fmt,
} from "../deskUi";

export function DeskRoster({
  team,
  preview,
  inviteUrl,
  sessionSub,
  sessionToken,
  withAuth,
  onToast,
  onCopyWelcome,
}: {
  team: TeamBundle;
  preview: boolean;
  inviteUrl: string;
  sessionSub?: string;
  sessionToken?: string;
  withAuth: (fn: () => Promise<void>) => Promise<void>;
  onToast: (msg: string) => void;
  onCopyWelcome: (m: TeamMember) => Promise<void>;
}) {
  const sorted = useMemo(() => {
    return [...team.members].sort((a, b) => {
      if (a.role === "leader" && b.role !== "leader") return -1;
      if (b.role === "leader" && a.role !== "leader") return 1;
      if (!!a.isLive !== !!b.isLive) return a.isLive ? -1 : 1;
      return (b.totalEarned || 0) - (a.totalEarned || 0);
    });
  }, [team.members]);

  const liveCount = team.liveNowCount;
  const inactiveCount = team.inactiveCount;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <SectionTitle>
            {team.isLeader ? "Roster management" : "Team roster"}
          </SectionTitle>
          <p className="mt-[-0.5rem] text-sm text-[var(--blyp-muted)]">
            {team.memberCount} members · {liveCount} live · {inactiveCount}{" "}
            quiet
            {team.isLeader
              ? " — accept joins, nudge hosts, export CSV"
              : " — who’s on your team"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            exportRosterCsv(team);
            onToast("Roster CSV downloaded");
          }}
          className="rounded-lg border border-[var(--blyp-line)] px-3.5 py-2 text-xs font-semibold"
        >
          Export CSV
        </button>
      </div>

      {team.isLeader ? (
        <section id="join-requests">
          <SectionTitle
            aside={
              <span className="text-xs text-[var(--blyp-muted)]">
                {team.joinRequests.length} pending
              </span>
            }
          >
            Join requests
          </SectionTitle>
          {team.joinRequests.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[var(--blyp-line)] px-4 py-6 text-sm text-[var(--blyp-muted)]">
              None pending. Invite hosts from Recruit & money — they land here
              for accept / decline.
            </p>
          ) : (
            <ul className="space-y-2">
              {team.joinRequests.map((req) => (
                <JoinRequestRow
                  key={req.uid}
                  req={req}
                  team={team}
                  preview={preview}
                  withAuth={withAuth}
                  sessionSub={sessionSub}
                  sessionToken={sessionToken}
                  onToast={onToast}
                  onCopyWelcome={onCopyWelcome}
                />
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section>
        <SectionTitle>Everyone</SectionTitle>
        <ul className="divide-y divide-[var(--blyp-line)] overflow-hidden rounded-xl border border-[var(--blyp-line)] bg-[var(--blyp-ink-elevated)]">
          {sorted.map((m) => (
            <li key={m.uid} className="px-3 py-3 sm:px-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar
                    name={m.displayName}
                    photoURL={m.photoURL}
                    size={48}
                    liveRing={!!m.isLive}
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="truncate font-semibold">{m.displayName}</p>
                      <RolePill role={m.role} />
                      {m.isLive ? <LivePill /> : null}
                    </div>
                    <p className="truncate text-xs text-[var(--blyp-muted)]">
                      @{m.username}
                      {m.hoursLive
                        ? ` · ${fmt(m.hoursLive)}h this week`
                        : " · hours —"}
                      {m.liveTitle && m.isLive ? ` · ${m.liveTitle}` : ""}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-right">
                    <p className="text-sm font-semibold text-[var(--blyp-gold)]">
                      {fmt(m.totalEarned || 0)}
                    </p>
                    <p className="text-[10px] uppercase tracking-wide text-[var(--blyp-muted)]">
                      gems
                    </p>
                  </div>
                  {team.isLeader && m.role !== "leader" ? (
                    <HostMessageButtons
                      teamName={team.name}
                      inviteUrl={inviteUrl}
                      leaderName={team.leaderName}
                      hostName={m.displayName}
                      onToast={onToast}
                    />
                  ) : null}
                  {team.isLeader &&
                  m.role !== "leader" &&
                  m.uid !== team.leaderId ? (
                    <button
                      type="button"
                      onClick={() =>
                        void withAuth(async () => {
                          if (!sessionSub || !sessionToken) return;
                          if (
                            !preview &&
                            !window.confirm(
                              `Remove @${m.username} from the team?`,
                            )
                          ) {
                            return;
                          }
                          await removeTeamMemberWeb(
                            team.teamId,
                            m.uid,
                            sessionSub,
                            sessionToken,
                          );
                          onToast(`Removed @${m.username}`);
                        })
                      }
                      className="rounded-lg border border-[var(--blyp-rose)]/30 px-2.5 py-1.5 text-xs font-semibold text-[var(--blyp-rose)]"
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function JoinRequestRow({
  req,
  team,
  withAuth,
  sessionSub,
  sessionToken,
  onToast,
  onCopyWelcome,
}: {
  req: TeamJoinRequest;
  team: TeamBundle;
  preview?: boolean;
  withAuth: (fn: () => Promise<void>) => Promise<void>;
  sessionSub?: string;
  sessionToken?: string;
  onToast: (msg: string) => void;
  onCopyWelcome: (m: TeamMember) => Promise<void>;
}) {
  return (
    <li className="rounded-xl border border-[var(--blyp-line)] bg-[var(--blyp-ink-elevated)] px-4 py-3">
      <PersonLine
        name={req.displayName}
        handle={req.username}
        photoURL={req.photoURL}
        size={44}
        meta={
          req.message ? (
            <p className="mt-0.5 text-sm text-[var(--blyp-muted)]">
              {req.message}
            </p>
          ) : null
        }
        trailing={
          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg bg-[var(--blyp-teal)] px-3 py-1.5 text-xs font-bold text-[var(--blyp-ink)]"
              onClick={() =>
                void withAuth(async () => {
                  if (!sessionSub || !sessionToken) return;
                  await acceptJoinRequestWeb(
                    team.teamId,
                    req,
                    sessionSub,
                    sessionToken,
                  );
                  await onCopyWelcome({
                    uid: req.uid,
                    displayName: req.displayName,
                    username: req.username,
                    role: "member",
                    photoURL: req.photoURL,
                  });
                  onToast(`Accepted @${req.username} — welcome copied`);
                })
              }
            >
              Accept
            </button>
            <button
              type="button"
              className="rounded-lg border border-[var(--blyp-line)] px-3 py-1.5 text-xs font-semibold"
              onClick={() =>
                void withAuth(async () => {
                  if (!sessionSub || !sessionToken) return;
                  await rejectJoinRequestWeb(
                    team.teamId,
                    req.uid,
                    sessionSub,
                    sessionToken,
                  );
                  onToast("Declined");
                })
              }
            >
              Decline
            </button>
          </div>
        }
      />
    </li>
  );
}
