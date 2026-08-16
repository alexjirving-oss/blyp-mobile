"use client";

import { useMemo, useState } from "react";
import { AGENCY_RATE_BASE } from "@/lib/teamEconomy";
import type { TeamBundle, TeamMember } from "@/lib/teams";
import { Avatar, SectionTitle, battleBucket, fmt } from "../deskUi";

type BoardId =
  | "gifters"
  | "supporters"
  | "presence"
  | "battle"
  | "overall";

type BoardMeta = {
  id: BoardId;
  label: string;
  units: string;
  note: string;
};

/** Equal sibling boards → Overall. Labels match product lock. */
const EQUAL_BOARDS: Exclude<BoardId, "overall">[] = [
  "gifters",
  "supporters",
  "presence",
  "battle",
];

const BOARDS: BoardMeta[] = [
  {
    id: "gifters",
    label: "Top Gifters",
    units: "creator gems (gift volume proxy)",
    note: "Who pulled the most gift volume — money energy, labeled in gem units from roster earnings.",
  },
  {
    id: "supporters",
    label: "Top Supporters",
    units: "battle / team reinvestment coins",
    note: "Coins put back into battles and team culture — not raw gift vanity.",
  },
  {
    id: "presence",
    label: "Presence",
    units: "LIVE hours + battles entered",
    note: "Who showed up — LIVE hours now, plus accepted fights started. Messaging / dating fold in later.",
  },
  {
    id: "battle",
    label: "Battle Record",
    units: "fights · W/L when scored",
    note: "Accepted battles fought. Wins/losses appear when scored fights land a winner.",
  },
  {
    id: "overall",
    label: "Overall",
    units: "equal-weight rank points",
    note: "Mean of rank-points across the four equal boards — #1 on coins alone can lose Overall.",
  },
];

const SEASON_PRIZES = [
  { place: "1st", coins: 10_000, label: "10,000 coins" },
  { place: "2nd", coins: 5_000, label: "5,000 coins" },
  { place: "3rd", coins: 2_500, label: "2,500 coins" },
] as const;

/** OPEN points table lean: #1 = depth, #2 = depth−1, … floor 0. */
const RANK_DEPTH = 20;

type RankCell = {
  rank: number | null;
  points: number;
  metric: number;
};

type BoardRow = {
  m: TeamMember;
  metric: number;
  label: string;
  sub?: string;
  breakdown?: { id: BoardId; short: string; rank: number | null; points: number }[];
  scoreDetail?: string;
};

function rankPoints(rank: number | null, depth = RANK_DEPTH): number {
  if (rank == null || rank <= 0) return 0;
  return Math.max(0, depth - rank + 1);
}

function isFought(status: string): boolean {
  const bucket = battleBucket(status);
  return bucket === "live" || bucket === "done";
}

function battleStats(m: TeamMember, team: TeamBundle) {
  let fought = 0;
  let wins = 0;
  let losses = 0;
  let scored = 0;
  for (const b of team.teamBattles) {
    if (b.aUid !== m.uid && b.bUid !== m.uid) continue;
    if (!isFought(b.status)) continue;
    fought += 1;
    if (b.winnerUid) {
      scored += 1;
      if (b.winnerUid === m.uid) wins += 1;
      else losses += 1;
    }
  }
  return { fought, wins, losses, scored };
}

function presenceMetric(m: TeamMember, team: TeamBundle): number {
  const hours = m.hoursLive || 0;
  const { fought } = battleStats(m, team);
  return hours * 10 + fought * 4 + (m.isLive ? 5 : 0);
}

function giftMetric(m: TeamMember): number {
  return m.totalEarned || 0;
}

/** Supporters ledger not wired yet — always 0 until coin reinvestment events exist. */
function supportMetric(): number {
  return 0;
}

function buildRankMap(
  members: TeamMember[],
  metricOf: (m: TeamMember) => number,
): Map<string, RankCell> {
  const active = members
    .map((m) => ({ m, metric: metricOf(m) }))
    .filter((r) => r.metric > 0)
    .sort((a, b) => b.metric - a.metric);

  const map = new Map<string, RankCell>();
  active.forEach((row, i) => {
    const rank = i + 1;
    map.set(row.m.uid, {
      rank,
      points: rankPoints(rank),
      metric: row.metric,
    });
  });
  for (const m of members) {
    if (!map.has(m.uid)) {
      map.set(m.uid, { rank: null, points: 0, metric: metricOf(m) });
    }
  }
  return map;
}

const BOARD_SHORT: Record<Exclude<BoardId, "overall">, string> = {
  gifters: "G",
  supporters: "S",
  presence: "P",
  battle: "B",
};

export function DeskBoards({ team }: { team: TeamBundle }) {
  const [board, setBoard] = useState<BoardId>("overall");
  const members = team.members;

  const ranks = useMemo(() => {
    return {
      gifters: buildRankMap(members, giftMetric),
      supporters: buildRankMap(members, () => supportMetric()),
      presence: buildRankMap(members, (m) => presenceMetric(m, team)),
      battle: buildRankMap(members, (m) => battleStats(m, team).fought),
    };
  }, [members, team]);

  const supportersReady = false; // ledger / reinvestment events not on desk yet

  const rows: BoardRow[] = useMemo(() => {
    if (board === "gifters") {
      return members
        .map((m) => {
          const metric = giftMetric(m);
          return {
            m,
            metric,
            label: metric ? fmt(metric) : "—",
            sub: metric ? "creator gems" : undefined,
          };
        })
        .sort((a, b) => b.metric - a.metric);
    }
    if (board === "supporters") {
      return members.map((m) => ({
        m,
        metric: 0,
        label: "—",
      }));
    }
    if (board === "presence") {
      return members
        .map((m) => {
          const metric = presenceMetric(m, team);
          const hours = m.hoursLive || 0;
          const { fought } = battleStats(m, team);
          const bits = [
            hours ? `${fmt(hours)}h LIVE` : null,
            fought ? `${fought} fight${fought === 1 ? "" : "s"}` : null,
            m.isLive ? "LIVE now" : null,
          ].filter(Boolean);
          return {
            m,
            metric,
            label: metric ? (hours ? `${fmt(hours)}h` : String(fought)) : "—",
            sub: bits.length ? bits.join(" · ") : undefined,
          };
        })
        .sort((a, b) => b.metric - a.metric);
    }
    if (board === "battle") {
      return members
        .map((m) => {
          const { fought, wins, losses, scored } = battleStats(m, team);
          const wl =
            scored > 0
              ? `${wins}W–${losses}L`
              : fought
                ? "W/L pending scores"
                : undefined;
          return {
            m,
            metric: fought,
            label: fought ? String(fought) : "—",
            sub: wl,
          };
        })
        .sort((a, b) => b.metric - a.metric);
    }

    // Overall — equal mean of rank-points across all four sibling boards
    return members
      .map((m) => {
        const breakdown = EQUAL_BOARDS.map((id) => {
          const cell = ranks[id].get(m.uid)!;
          return {
            id,
            short: BOARD_SHORT[id],
            rank: cell.rank,
            points: cell.points,
          };
        });
        const score =
          breakdown.reduce((s, b) => s + b.points, 0) / EQUAL_BOARDS.length;
        const scoreDetail = breakdown
          .map((b) =>
            b.rank != null
              ? `${b.short}#${b.rank} (${b.points}pt)`
              : `${b.short}— (0pt)`,
          )
          .join(" · ");
        return {
          m,
          metric: score,
          label: score > 0 ? score.toFixed(1) : "—",
          breakdown,
          scoreDetail,
        };
      })
      .sort((a, b) => b.metric - a.metric);
  }, [board, members, ranks, team]);

  const meta = BOARDS.find((b) => b.id === board)!;
  const hasActivity =
    board === "supporters"
      ? false
      : board === "overall"
        ? rows.some((r) => r.metric > 0)
        : rows.some((r) => r.metric > 0);

  const emptyCopy =
    board === "supporters"
      ? "Top Supporters needs battle / team reinvestment coin events. No support ledger on the desk yet — board stays empty rather than inventing numbers."
      : board === "gifters"
        ? "No roster gift volume yet. When hosts earn creator gems from gifts, they’ll rank here."
        : board === "presence"
          ? "No LIVE hours or fought battles in this window yet. Go LIVE or take a fight to climb Presence."
          : board === "battle"
            ? "No accepted fights started yet. Pending invites don’t count — finish or go live in a battle."
            : "Overall needs activity on at least one equal board. Climb Gifters, Presence, or Battle Record to appear.";

  return (
    <div className="space-y-6">
      <div>
        <SectionTitle>Leaderboards</SectionTitle>
        <p className="mt-[-0.5rem] text-sm text-[var(--blyp-muted)]">
          Equal-weight boards → Overall final board. Same desk for boss and
          members. Agency cut stays{" "}
          {Math.round(AGENCY_RATE_BASE * 100)}% from Blyp’s half — never mixed
          into these ranks.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {BOARDS.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => setBoard(b.id)}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold ${
              board === b.id
                ? "bg-[var(--blyp-teal)] text-[var(--blyp-ink)]"
                : "border border-[var(--blyp-line)] text-[var(--blyp-fog)]"
            }`}
          >
            {b.label}
          </button>
        ))}
      </div>

      {board === "overall" ? (
        <div className="rounded-xl border border-[var(--blyp-gold)]/35 bg-[rgba(232,196,124,0.08)] p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--blyp-gold)]">
            Season podium · Overall
          </p>
          <p className="mt-1 text-sm text-[var(--blyp-muted)]">
            Platform prizes pay from Overall — not from a single money board.
            Paid in coins so value stays in the economy. Window cadence still
            open.
          </p>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {SEASON_PRIZES.map((p) => (
              <div
                key={p.place}
                className="rounded-lg border border-[var(--blyp-line)] bg-[var(--blyp-ink)]/40 px-3 py-3 text-center"
              >
                <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--blyp-muted)]">
                  {p.place}
                </p>
                <p className="font-display mt-1 text-lg font-bold text-[var(--blyp-gold)] sm:text-xl">
                  {p.label.split(" ")[0]}
                </p>
                <p className="text-[10px] text-[var(--blyp-muted)]">coins</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="rounded-xl border border-[var(--blyp-line)] bg-[var(--blyp-ink-elevated)] p-4">
        <p className="text-sm text-[var(--blyp-muted)]">{meta.note}</p>
        <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--blyp-muted)]">
          Units · {meta.units}
          {board === "overall"
            ? ` · #1 = ${RANK_DEPTH} pts, then −1 · missing board = 0`
            : ""}
        </p>

        {board === "overall" ? (
          <p className="mt-3 rounded-lg border border-dashed border-[var(--blyp-line)] px-3 py-2 text-xs text-[var(--blyp-muted)]">
            Score = mean of rank-points across Top Gifters, Top Supporters,
            Presence, and Battle Record
            {!supportersReady
              ? " (Supporters currently 0 for everyone until the support ledger lands)"
              : ""}
            . Breakdown under each name — no mystery KPI.
          </p>
        ) : null}

        {!hasActivity ? (
          <p className="mt-6 rounded-lg border border-dashed border-[var(--blyp-line)] px-4 py-8 text-center text-sm text-[var(--blyp-muted)]">
            {emptyCopy}
          </p>
        ) : (
          <ol className="mt-4 divide-y divide-[var(--blyp-line)] overflow-hidden rounded-xl border border-[var(--blyp-line)]">
            {rows
              .filter((row) => row.metric > 0)
              .map((row, i) => (
                <li
                  key={row.m.uid}
                  className="flex items-start justify-between gap-3 bg-[var(--blyp-ink)]/30 px-3 py-3"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="mt-1.5 w-6 shrink-0 text-center font-display text-sm font-bold text-[var(--blyp-muted)]">
                      {i + 1}
                    </span>
                    <Avatar
                      name={row.m.displayName}
                      photoURL={row.m.photoURL}
                      size={36}
                      liveRing={!!row.m.isLive}
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">
                        {row.m.displayName}
                      </p>
                      <p className="truncate text-xs text-[var(--blyp-muted)]">
                        @{row.m.username}
                        {row.sub ? ` · ${row.sub}` : ""}
                      </p>
                      {row.scoreDetail ? (
                        <p className="mt-1 text-[10px] leading-relaxed text-[var(--blyp-muted)]">
                          {row.scoreDetail}
                        </p>
                      ) : null}
                      {row.breakdown ? (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {row.breakdown.map((b) => (
                            <span
                              key={b.id}
                              className="rounded-md bg-white/[0.05] px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-[var(--blyp-fog)]"
                              title={`${BOARDS.find((x) => x.id === b.id)?.label}: ${
                                b.rank != null ? `#${b.rank}` : "unranked"
                              } · ${b.points} pts`}
                            >
                              {b.short}
                              {b.rank != null ? `#${b.rank}` : "—"}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 pt-1 text-sm font-semibold ${
                      board === "gifters" || board === "overall"
                        ? "text-[var(--blyp-gold)]"
                        : "text-[var(--blyp-fog)]"
                    }`}
                  >
                    {row.label}
                  </span>
                </li>
              ))}
          </ol>
        )}
      </div>

      <p className="text-[11px] text-[var(--blyp-muted)]">
        Money boards stay in coin/gem units. Presence and Battle Record stay in
        time / counts. Overall never mixes diamonds with minutes into one opaque
        number — only equal rank-points.
      </p>
    </div>
  );
}
