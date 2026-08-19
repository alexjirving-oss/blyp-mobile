"use client";

import Link from "next/link";
import { useMemo } from "react";
import { AGENCY_RATE_BASE } from "@/lib/teamEconomy";
import type { TeamBundle, TeamMember } from "@/lib/teams";
import { HostMessageButtons } from "../ShareRecruitHub";
import {
  Avatar,
  Kpi,
  LivePill,
  PersonLine,
  SectionTitle,
  battleBucket,
  fmt,
} from "../deskUi";

export function DeskOverview({
  team,
  preview,
  inviteUrl,
  onToast,
  onGoTab,
}: {
  team: TeamBundle;
  preview: boolean;
  inviteUrl: string;
  onToast: (msg: string) => void;
  onGoTab: (tab: string) => void;
}) {
  const liveMembers = useMemo(
    () => team.members.filter((m) => m.isLive),
    [team.members],
  );
  const inactive = useMemo(
    () =>
      team.members.filter(
        (m) => m.role !== "leader" && !(m.hoursLive || 0) && !m.isLive,
      ),
    [team.members],
  );
  const hoursWeek = useMemo(() => {
    if (team.weeklyHours != null && team.weeklyHours > 0) return team.weeklyHours;
    const sum = team.members.reduce((s, m) => s + (m.hoursLive || 0), 0);
    return sum > 0 ? sum : null;
  }, [team]);
  const pendingBattles = useMemo(
    () =>
      team.teamBattles.filter((b) => battleBucket(b.status) === "pending").length,
    [team.teamBattles],
  );
  const liveBattles = useMemo(
    () => team.teamBattles.filter((b) => battleBucket(b.status) === "live").length,
    [team.teamBattles],
  );
  const pendingInvites = useMemo(
    () => (team.referrals || []).filter((r) => r.status === "pending").length,
    [team.referrals],
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 overflow-hidden rounded-[20px] bg-[#12121a] shadow-[0_0_0_1px_var(--blyp-line)] sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Roster" value={String(team.members.length)} />
        <Kpi
          label="Who’s live"
          value={liveMembers.length ? String(liveMembers.length) : "—"}
          hint={liveMembers.length ? "Across your roster" : "Nobody live"}
        />
        <Kpi
          label="Hours this week"
          value={hoursWeek != null ? fmt(hoursWeek) : "—"}
          hint={hoursWeek == null ? "No hours logged" : undefined}
        />
        {team.isLeader ? (
          <Kpi
            label="Agency cut"
            value={
              team.agencyEarningsIsEstimate
                ? "—"
                : fmt(team.agencyEarningsDisplay)
            }
            hint={
              team.agencyEarningsIsEstimate
                ? "No live cut yet — not estimated here"
                : `${Math.round(AGENCY_RATE_BASE * 100)}% from Blyp half`
            }
          />
        ) : (
          <Kpi
            label="Pending battles"
            value={pendingBattles ? String(pendingBattles) : "—"}
            hint="Awaiting accept / start"
          />
        )}
        <Kpi
          label="Roster gifts"
          value={team.teamTotalGems ? fmt(team.teamTotalGems) : "—"}
          hint="Creator half"
        />
        <Kpi
          label="Battles"
          value={
            liveBattles > 0
              ? `${liveBattles} live`
              : pendingBattles > 0
                ? String(pendingBattles)
                : team.teamBattles.length
                  ? String(team.teamBattles.length)
                  : "—"
          }
          hint={liveBattles > 0 ? "Active now" : "Scheduled / arranged"}
        />
      </div>

      {team.isLeader &&
      (team.joinRequests.length > 0 ||
        inactive.length > 0 ||
        pendingInvites > 0) ? (
        <div className="flex flex-wrap gap-2 text-xs">
          {team.joinRequests.length > 0 ? (
            <button
              type="button"
              onClick={() => onGoTab("roster")}
              className="rounded-md border border-[var(--blyp-gold)]/40 bg-[rgba(232,196,124,0.1)] px-3 py-1.5 font-semibold text-[var(--blyp-gold)]"
            >
              {team.joinRequests.length} join request
              {team.joinRequests.length === 1 ? "" : "s"} — review on Roster
            </button>
          ) : null}
          {inactive.length > 0 ? (
            <button
              type="button"
              onClick={() => onGoTab("roster")}
              className="rounded-md border border-[var(--blyp-rose)]/30 bg-[rgba(240,160,184,0.08)] px-3 py-1.5 font-semibold text-[var(--blyp-rose)]"
            >
              {inactive.length} late / offline — nudge
            </button>
          ) : null}
          {pendingInvites > 0 ? (
            <button
              type="button"
              onClick={() => onGoTab("recruit")}
              className="rounded-md border border-[var(--blyp-teal)]/30 bg-[rgba(0,210,190,0.08)] px-3 py-1.5 font-semibold text-[var(--blyp-teal)]"
            >
              {pendingInvites} pending email invite
              {pendingInvites === 1 ? "" : "s"}
            </button>
          ) : null}
        </div>
      ) : null}

      {!team.isLeader ? (
        <div className="rounded-xl border border-[var(--blyp-line)] bg-[var(--blyp-ink-elevated)] p-4">
          <SectionTitle
            aside={
              <button
                type="button"
                onClick={() => onGoTab("battles")}
                className="text-xs font-semibold text-[var(--blyp-teal)]"
              >
                Open Battles →
              </button>
            }
          >
            Your desk
          </SectionTitle>
          <p className="text-sm text-[var(--blyp-muted)]">
            Same Teams place as your boss — pick battles with your roster and
            linked agency opponents, track pending / live / done, and climb the
            boards.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <QuickStat
              label="Team battles"
              value={team.teamBattles.length ? String(team.teamBattles.length) : "—"}
            />
            <QuickStat
              label="Pending"
              value={pendingBattles ? String(pendingBattles) : "—"}
            />
            <QuickStat
              label="LIVE now"
              value={liveMembers.length ? String(liveMembers.length) : "—"}
            />
          </div>
        </div>
      ) : null}

      <div className="rounded-xl border border-[var(--blyp-line)] bg-[var(--blyp-ink-elevated)] p-4">
        <SectionTitle
          aside={
            <button
              type="button"
              onClick={() => onGoTab("boards")}
              className="text-xs font-semibold text-[var(--blyp-teal)]"
            >
              Open Boards →
            </button>
          }
        >
          Boards · Overall
        </SectionTitle>
        <p className="text-sm text-[var(--blyp-muted)]">
          Equal-weight Top Gifters, Top Supporters, Presence, and Battle Record
          → Overall. Season podium: 10k / 5k / 2.5k coins. Agency cut stays{" "}
          {Math.round(AGENCY_RATE_BASE * 100)}% — not mixed into ranks.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-[var(--blyp-line)] bg-[var(--blyp-ink-elevated)] p-4">
          <SectionTitle
            aside={
              <Link
                href="/live"
                className="text-xs font-semibold text-[var(--blyp-teal)]"
              >
                Open LIVE →
              </Link>
            }
          >
            LIVE roster
          </SectionTitle>
          {liveMembers.length === 0 ? (
            <div className="hub-empty" style={{ padding: "0.5rem 0 0.25rem" }}>
              <div className="hub-empty-stage" style={{ minHeight: "5.5rem" }}>
                <span>NOBODY LIVE</span>
              </div>
              <p className="hub-empty-copy">
                Nobody on this roster is live right now.
                {team.isLeader ? " Nudge offline hosts on Roster." : ""}
              </p>
            </div>
          ) : (
            <ul className="space-y-2.5">
              {liveMembers.map((m) => (
                <LiveMemberRow
                  key={m.uid}
                  m={m}
                  preview={preview}
                />
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-[var(--blyp-line)] bg-[var(--blyp-ink-elevated)] p-4">
          <SectionTitle
            aside={
              <button
                type="button"
                onClick={() => onGoTab("battles")}
                className="text-xs font-semibold text-[var(--blyp-teal)]"
              >
                All battles →
              </button>
            }
          >
            {team.isLeader ? "Active & pending battles" : "Your match feed"}
          </SectionTitle>
          {team.teamBattles.length === 0 ? (
            <div className="hub-empty" style={{ padding: "0.5rem 0 0.25rem" }}>
              <div className="hub-empty-stage" style={{ minHeight: "5.5rem" }}>
                <span>NO BATTLES</span>
              </div>
              <p className="hub-empty-copy">
                {team.isLeader
                  ? "None set yet. Schedule an internal match on Battles."
                  : "No battles yet — open Battles to pick a roster or linked-agency opponent."}
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {team.teamBattles.slice(0, 6).map((b) => {
                const bucket = battleBucket(b.status);
                const a = team.members.find((m) => m.uid === b.aUid);
                const bb = team.members.find((m) => m.uid === b.bUid);
                return (
                  <li
                    key={b.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-[var(--blyp-line)] px-3 py-2.5"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <Avatar name={b.aName} photoURL={a?.photoURL} size={28} />
                      <span className="text-xs text-[var(--blyp-muted)]">vs</span>
                      <Avatar name={b.bName} photoURL={bb?.photoURL} size={28} />
                      <span className="truncate text-sm font-medium">
                        {b.aName} vs {b.bName}
                      </span>
                    </div>
                    <span
                      className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                        bucket === "live"
                          ? "bg-[#fe2c55]/15 text-[#fe2c55]"
                          : bucket === "pending"
                            ? "bg-[rgba(232,196,124,0.12)] text-[var(--blyp-gold)]"
                            : "bg-white/[0.06] text-[var(--blyp-muted)]"
                      }`}
                    >
                      {bucket === "other" ? b.status : bucket}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {team.isLeader && inactive.length > 0 ? (
        <section className="rounded-xl border border-[var(--blyp-line)] bg-[var(--blyp-ink-elevated)] p-4">
          <SectionTitle>Needs a nudge</SectionTitle>
          <ul className="space-y-2.5">
            {inactive.slice(0, 4).map((m) => (
              <li key={m.uid}>
                <PersonLine
                  name={m.displayName}
                  handle={m.username}
                  photoURL={m.photoURL}
                  size={34}
                  trailing={
                    <HostMessageButtons
                      teamName={team.name}
                      inviteUrl={inviteUrl}
                      leaderName={team.leaderName}
                      hostName={m.displayName}
                      onToast={onToast}
                    />
                  }
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function QuickStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--blyp-line)] bg-[var(--blyp-ink)]/50 px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--blyp-muted)]">
        {label}
      </p>
      <p className="font-display mt-0.5 text-xl font-bold">{value}</p>
    </div>
  );
}

function LiveMemberRow({
  m,
  preview,
}: {
  m: TeamMember;
  preview: boolean;
}) {
  return (
    <li className="rounded-xl border border-[var(--blyp-line)] bg-[var(--blyp-ink)]/60 px-3 py-2.5">
      <PersonLine
        name={m.displayName}
        handle={m.username}
        photoURL={m.photoURL}
        size={44}
        live
        meta={
          <p className="truncate text-xs text-[var(--blyp-muted)]">
            {m.liveTitle || "LIVE"}
            {m.liveViewers != null ? ` · ${m.liveViewers} watching` : ""}
          </p>
        }
        trailing={
          m.liveStreamId && !preview ? (
            <Link
              href={`/live/${encodeURIComponent(m.liveStreamId)}`}
              className="shrink-0 rounded-lg bg-[var(--blyp-teal)] px-3 py-1.5 text-[11px] font-bold text-[var(--blyp-ink)]"
            >
              Watch
            </Link>
          ) : (
            <LivePill />
          )
        }
      />
    </li>
  );
}
