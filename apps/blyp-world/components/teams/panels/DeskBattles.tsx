"use client";

import { useMemo, useState, type FormEvent } from "react";
import type {
  LinkedOpponent,
  TeamBattleParams,
  TeamBundle,
  TeamMember,
} from "@/lib/teams";
import {
  createTeamBattleWeb,
  DEFAULT_BATTLE_PARAMS,
  saveBattleParamsWeb,
} from "@/lib/teams";
import { Avatar, SectionTitle, battleBucket } from "../deskUi";

export function DeskBattles({
  team,
  preview,
  sessionSub,
  sessionToken,
  withAuth,
  onToast,
}: {
  team: TeamBundle;
  preview: boolean;
  sessionSub?: string;
  sessionToken?: string;
  withAuth: (fn: () => Promise<void>) => Promise<void>;
  onToast: (msg: string) => void;
}) {
  const [battleA, setBattleA] = useState("");
  const [battleB, setBattleB] = useState("");
  const [battleNote, setBattleNote] = useState("");
  const [params, setParams] = useState<TeamBattleParams>(
    () => team.battleParams || DEFAULT_BATTLE_PARAMS,
  );
  const [challengeNote, setChallengeNote] = useState("");
  const [challengingUid, setChallengingUid] = useState<string | null>(null);

  const buckets = useMemo(() => {
    const pending: typeof team.teamBattles = [];
    const live: typeof team.teamBattles = [];
    const done: typeof team.teamBattles = [];
    const other: typeof team.teamBattles = [];
    for (const b of team.teamBattles) {
      const k = battleBucket(b.status);
      if (k === "pending") pending.push(b);
      else if (k === "live") live.push(b);
      else if (k === "done") done.push(b);
      else other.push(b);
    }
    return { pending, live, done, other };
  }, [team]);

  const opponents = useMemo(() => {
    if (team.linkedOpponents?.length) {
      return team.linkedOpponents.filter((o) => o.uid !== sessionSub);
    }
    // Fallback: roster-only if links not hydrated yet
    return team.members
      .filter((m) => m.role !== "leader" && m.uid !== sessionSub)
      .map(
        (m): LinkedOpponent => ({
          uid: m.uid,
          displayName: m.displayName,
          username: m.username,
          photoURL: m.photoURL,
          isLive: m.isLive,
          teamId: team.teamId,
          teamName: "Your roster",
          linkVisibility: "private",
          source: "roster",
        }),
      );
  }, [team, sessionSub]);

  const rosterOpponents = opponents.filter((o) => o.source === "roster");
  const linkedAgencyOpponents = opponents.filter((o) => o.source === "linked");
  const canMemberChallenge =
    !team.isLeader &&
    (team.battleParams?.challengers || "members") === "members";

  const challengeOpponent = (opp: LinkedOpponent) => {
    if (!canMemberChallenge) {
      onToast("Boss locked challenges to leaders only");
      return;
    }
    if (opp.source === "roster" && !team.battleParams?.allowInternal) {
      onToast("Internal challenges are off");
      return;
    }
    if (opp.source === "linked" && !team.battleParams?.allowLinked) {
      onToast("Linked-agency challenges are off");
      return;
    }
    const me = team.members.find((m) => m.uid === sessionSub);
    if (!preview && !me) {
      onToast("Couldn’t find you on this roster");
      return;
    }
    setChallengingUid(opp.uid);
    void withAuth(async () => {
      if (!sessionSub || !sessionToken) return;
      const self: TeamMember = me || {
        uid: sessionSub,
        displayName: "You",
        username: sessionSub.slice(0, 8),
        role: "member",
      };
      await createTeamBattleWeb(
        team.teamId,
        sessionSub,
        self,
        {
          uid: opp.uid,
          displayName: opp.displayName,
          username: opp.username,
          role: "member",
          photoURL: opp.photoURL,
        },
        challengeNote ||
          (opp.source === "linked"
            ? `Challenge · ${opp.teamName}`
            : "Roster challenge"),
        sessionToken,
        {
          asLeader: false,
          source: opp.source === "linked" ? "linked" : "internal",
          opponentTeamId:
            opp.source === "linked" ? opp.teamId : null,
          opponentTeamName:
            opp.source === "linked" ? opp.teamName : null,
          status: "pending",
        },
      );
      setChallengeNote("");
      onToast(`Challenge sent to ${opp.displayName}`);
    }).finally(() => setChallengingUid(null));
  };

  return (
    <div className="space-y-6">
      <div>
        <SectionTitle>
          {team.isLeader ? "Battles & parameters" : "Battles"}
        </SectionTitle>
        <p className="mt-[-0.5rem] text-sm text-[var(--blyp-muted)]">
          {team.isLeader
            ? "Set rails (duration, gift window, cooldown, who may challenge). Members pick within them — including linked agencies."
            : "Click an opponent from your roster or a linked agency. Pending / live / done stay in sync on both desks."}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <BucketCard
          title="Pending"
          count={buckets.pending.length}
          tone="gold"
          battles={buckets.pending}
          team={team}
          empty="No pending challenges."
        />
        <BucketCard
          title="Live"
          count={buckets.live.length}
          tone="live"
          battles={buckets.live}
          team={team}
          empty="Nothing live right now."
        />
        <BucketCard
          title="Done"
          count={buckets.done.length + buckets.other.length}
          tone="muted"
          battles={[...buckets.done, ...buckets.other]}
          team={team}
          empty="No finished battles yet."
        />
      </div>

      {!team.isLeader ? (
        <section className="rounded-xl border border-[var(--blyp-line)] bg-[var(--blyp-ink-elevated)] p-4 md:p-5">
          <SectionTitle>Pick an opponent</SectionTitle>
          <p className="mb-3 text-sm text-[var(--blyp-muted)]">
            Eligible: your roster
            {team.battleParams?.allowLinked !== false
              ? " + linked agency rosters"
              : ""}
            . Boss rails: {team.battleParams?.durationMinutes ?? 5}m battles ·{" "}
            {team.battleParams?.giftWindowMinutes ?? 5}m gift window ·{" "}
            {team.battleParams?.cooldownMinutes ?? 30}m cooldown.
          </p>
          {!canMemberChallenge ? (
            <p className="mb-3 rounded-lg border border-[var(--blyp-gold)]/30 bg-[rgba(232,196,124,0.08)] px-3 py-2 text-sm text-[var(--blyp-gold)]">
              Your boss locked challenges to leaders only.
            </p>
          ) : null}
          <input
            value={challengeNote}
            onChange={(e) => setChallengeNote(e.target.value)}
            placeholder="Optional note — e.g. tonight 9pm your local"
            maxLength={280}
            className="mb-4 w-full rounded-lg border border-[var(--blyp-line)] bg-[var(--blyp-ink)] px-3 py-2 text-sm"
          />

          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--blyp-muted)]">
            Your roster
          </h3>
          {rosterOpponents.length === 0 ? (
            <p className="mb-4 text-sm text-[var(--blyp-muted)]">
              No teammates to challenge yet.
            </p>
          ) : (
            <ul className="mb-5 divide-y divide-[var(--blyp-line)] overflow-hidden rounded-xl border border-[var(--blyp-line)]">
              {rosterOpponents.map((o) => (
                <OpponentRow
                  key={`r-${o.uid}`}
                  opp={o}
                  disabled={!canMemberChallenge || challengingUid === o.uid}
                  busy={challengingUid === o.uid}
                  onChallenge={() => challengeOpponent(o)}
                />
              ))}
            </ul>
          )}

          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--blyp-muted)]">
            Linked agencies
          </h3>
          {linkedAgencyOpponents.length === 0 ? (
            <p className="text-sm text-[var(--blyp-muted)]">
              No linked-agency opponents yet — your boss adds pairwise links on
              Agency links.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--blyp-line)] overflow-hidden rounded-xl border border-[var(--blyp-line)]">
              {linkedAgencyOpponents.map((o) => (
                <OpponentRow
                  key={`l-${o.teamId}-${o.uid}`}
                  opp={o}
                  disabled={!canMemberChallenge || challengingUid === o.uid}
                  busy={challengingUid === o.uid}
                  onChallenge={() => challengeOpponent(o)}
                />
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {team.isLeader ? (
        <section className="rounded-xl border border-[var(--blyp-line)] bg-[var(--blyp-ink-elevated)] p-4 md:p-5">
          <SectionTitle>Battle parameters</SectionTitle>
          <p className="mb-4 text-sm text-[var(--blyp-muted)]">
            Rails only — members arrange within these. Pairwise agency links are
            on the Agency links tab.
          </p>
          <form
            className="grid gap-3 sm:grid-cols-3"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              void withAuth(async () => {
                if (!sessionSub || !sessionToken) return;
                await saveBattleParamsWeb(
                  team.teamId,
                  sessionSub,
                  params,
                  sessionToken,
                );
                onToast("Battle parameters saved");
              });
            }}
          >
            <label className="text-xs text-[var(--blyp-muted)]">
              Duration (min)
              <input
                type="number"
                min={1}
                max={60}
                value={params.durationMinutes}
                onChange={(e) =>
                  setParams((p) => ({
                    ...p,
                    durationMinutes: Number(e.target.value) || 5,
                  }))
                }
                className="mt-1 w-full rounded-lg border border-[var(--blyp-line)] bg-[var(--blyp-ink)] px-2 py-2 text-sm text-[var(--blyp-fog)]"
              />
            </label>
            <label className="text-xs text-[var(--blyp-muted)]">
              Gift window (min)
              <input
                type="number"
                min={1}
                max={60}
                value={params.giftWindowMinutes}
                onChange={(e) =>
                  setParams((p) => ({
                    ...p,
                    giftWindowMinutes: Number(e.target.value) || 5,
                  }))
                }
                className="mt-1 w-full rounded-lg border border-[var(--blyp-line)] bg-[var(--blyp-ink)] px-2 py-2 text-sm text-[var(--blyp-fog)]"
              />
            </label>
            <label className="text-xs text-[var(--blyp-muted)]">
              Cooldown (min)
              <input
                type="number"
                min={0}
                max={1440}
                value={params.cooldownMinutes}
                onChange={(e) =>
                  setParams((p) => ({
                    ...p,
                    cooldownMinutes: Number(e.target.value) || 0,
                  }))
                }
                className="mt-1 w-full rounded-lg border border-[var(--blyp-line)] bg-[var(--blyp-ink)] px-2 py-2 text-sm text-[var(--blyp-fog)]"
              />
            </label>
            <label className="flex items-center gap-2 text-sm sm:col-span-1">
              <input
                type="checkbox"
                checked={params.allowInternal}
                onChange={(e) =>
                  setParams((p) => ({ ...p, allowInternal: e.target.checked }))
                }
              />
              Internal roster challenges
            </label>
            <label className="flex items-center gap-2 text-sm sm:col-span-1">
              <input
                type="checkbox"
                checked={params.allowLinked}
                onChange={(e) =>
                  setParams((p) => ({ ...p, allowLinked: e.target.checked }))
                }
              />
              Linked-agency challenges
            </label>
            <label className="text-xs text-[var(--blyp-muted)] sm:col-span-1">
              Who may challenge
              <select
                value={params.challengers}
                onChange={(e) =>
                  setParams((p) => ({
                    ...p,
                    challengers:
                      e.target.value === "leader_only"
                        ? "leader_only"
                        : "members",
                  }))
                }
                className="mt-1 w-full rounded-lg border border-[var(--blyp-line)] bg-[var(--blyp-ink)] px-2 py-2 text-sm text-[var(--blyp-fog)]"
              >
                <option value="members">Members</option>
                <option value="leader_only">Boss only</option>
              </select>
            </label>
            <div className="sm:col-span-3">
              <button
                type="submit"
                className="rounded-lg bg-[var(--blyp-teal)] px-3 py-2 text-xs font-bold text-[var(--blyp-ink)]"
              >
                Save parameters
              </button>
              {preview ? (
                <span className="ml-2 text-xs text-[var(--blyp-muted)]">
                  Preview mode
                </span>
              ) : null}
            </div>
          </form>
        </section>
      ) : null}

      {team.isLeader && team.members.length >= 2 ? (
        <section className="rounded-xl border border-[var(--blyp-line)] bg-[var(--blyp-ink-elevated)] p-4 md:p-5">
          <SectionTitle>Schedule internal battle</SectionTitle>
          <form
            className="mt-2 space-y-2"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              const a = team.members.find((m) => m.uid === battleA);
              const b = team.members.find((m) => m.uid === battleB);
              if (!a || !b) {
                onToast("Pick two members");
                return;
              }
              void withAuth(async () => {
                if (!sessionSub || !sessionToken) return;
                await createTeamBattleWeb(
                  team.teamId,
                  sessionSub,
                  a,
                  b,
                  battleNote,
                  sessionToken,
                  { asLeader: true, source: "internal", status: "scheduled" },
                );
                setBattleNote("");
                onToast("Battle scheduled");
              });
            }}
          >
            <div className="grid gap-2 sm:grid-cols-2">
              <select
                value={battleA}
                onChange={(e) => setBattleA(e.target.value)}
                className="rounded-lg border border-[var(--blyp-line)] bg-[var(--blyp-ink)] px-2 py-2 text-sm"
                required
              >
                <option value="">Host A</option>
                {team.members.map((m) => (
                  <option key={m.uid} value={m.uid}>
                    {m.displayName}
                  </option>
                ))}
              </select>
              <select
                value={battleB}
                onChange={(e) => setBattleB(e.target.value)}
                className="rounded-lg border border-[var(--blyp-line)] bg-[var(--blyp-ink)] px-2 py-2 text-sm"
                required
              >
                <option value="">Host B</option>
                {team.members.map((m) => (
                  <option key={m.uid} value={m.uid}>
                    {m.displayName}
                  </option>
                ))}
              </select>
            </div>
            <input
              value={battleNote}
              onChange={(e) => setBattleNote(e.target.value)}
              placeholder="Note — e.g. Fri 9pm your local"
              maxLength={280}
              className="w-full rounded-lg border border-[var(--blyp-line)] bg-[var(--blyp-ink)] px-3 py-2 text-sm"
            />
            <button
              type="submit"
              className="rounded-lg bg-[var(--blyp-teal)] px-3 py-2 text-xs font-bold text-[var(--blyp-ink)]"
            >
              Schedule battle
            </button>
          </form>
        </section>
      ) : null}
    </div>
  );
}

function BucketCard({
  title,
  count,
  tone,
  battles,
  team,
  empty,
}: {
  title: string;
  count: number;
  tone: "gold" | "live" | "muted";
  battles: TeamBundle["teamBattles"];
  team: TeamBundle;
  empty: string;
}) {
  const toneClass =
    tone === "live"
      ? "text-[#fe2c55]"
      : tone === "gold"
        ? "text-[var(--blyp-gold)]"
        : "text-[var(--blyp-muted)]";
  return (
    <div className="rounded-xl border border-[var(--blyp-line)] bg-[var(--blyp-ink-elevated)] p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--blyp-muted)]">
          {title}
        </h3>
        <span className={`font-display text-2xl font-bold ${toneClass}`}>
          {count}
        </span>
      </div>
      {battles.length === 0 ? (
        <p className="text-sm text-[var(--blyp-muted)]">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {battles.slice(0, 5).map((b) => {
            const a = team.members.find((m) => m.uid === b.aUid);
            const bb = team.members.find((m) => m.uid === b.bUid);
            return (
              <li
                key={b.id}
                className="rounded-lg border border-[var(--blyp-line)] bg-[var(--blyp-ink)]/40 px-2.5 py-2"
              >
                <div className="flex items-center gap-1.5">
                  <Avatar name={b.aName} photoURL={a?.photoURL} size={24} />
                  <span className="text-[10px] text-[var(--blyp-muted)]">vs</span>
                  <Avatar name={b.bName} photoURL={bb?.photoURL} size={24} />
                </div>
                <p className="mt-1 truncate text-xs font-medium">
                  {b.aName} vs {b.bName}
                </p>
                <p className="truncate text-[10px] text-[var(--blyp-muted)]">
                  {b.opponentTeamName
                    ? `${b.opponentTeamName} · `
                    : b.source === "linked"
                      ? "Linked · "
                      : ""}
                  {b.note || b.status}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function OpponentRow({
  opp,
  disabled,
  busy,
  onChallenge,
}: {
  opp: LinkedOpponent;
  disabled?: boolean;
  busy?: boolean;
  onChallenge: () => void;
}) {
  return (
    <li className="flex items-center justify-between gap-3 px-3 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar
          name={opp.displayName}
          photoURL={opp.photoURL}
          size={40}
          liveRing={!!opp.isLive}
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{opp.displayName}</p>
          <p className="truncate text-xs text-[var(--blyp-muted)]">
            @{opp.username}
            {opp.isLive ? " · LIVE" : ""} · {opp.teamName}
            {opp.source === "linked"
              ? ` · ${opp.linkVisibility === "public" ? "public link" : "private link"}`
              : ""}
          </p>
        </div>
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={onChallenge}
        className="shrink-0 rounded-lg border border-[var(--blyp-teal)]/40 px-3 py-1.5 text-[11px] font-bold text-[var(--blyp-teal)] disabled:opacity-50"
      >
        {busy ? "…" : "Challenge"}
      </button>
    </li>
  );
}
