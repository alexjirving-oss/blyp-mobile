"use client";

import type { ReactNode } from "react";
import { formatEconomyShort } from "@/lib/teamEconomy";
import type { TeamBundle } from "@/lib/teams";

export function fmt(n: number) {
  return formatEconomyShort(n);
}

export function Avatar({
  name,
  photoURL,
  size = 40,
  liveRing = false,
}: {
  name: string;
  photoURL?: string | null;
  size?: number;
  liveRing?: boolean;
}) {
  const initials =
    (name || "?")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() || "")
      .join("") || "?";
  return (
    <div
      className={`relative shrink-0 ${liveRing ? "rounded-full ring-2 ring-[#fe2c55] ring-offset-2 ring-offset-[var(--blyp-ink)]" : ""}`}
      style={{ width: size, height: size }}
    >
      {photoURL ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photoURL}
          alt=""
          width={size}
          height={size}
          className="h-full w-full rounded-full object-cover"
        />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center rounded-full bg-[var(--blyp-teal)] font-bold text-[var(--blyp-ink)]"
          style={{ fontSize: Math.max(11, Math.round(size * 0.34)) }}
        >
          {initials}
        </div>
      )}
      {liveRing ? (
        <span className="absolute -bottom-0.5 -right-0.5 rounded bg-[#fe2c55] px-1 py-px text-[8px] font-extrabold leading-none text-white">
          LIVE
        </span>
      ) : null}
    </div>
  );
}

export function LivePill() {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-[#fe2c55]/15 px-1.5 py-0.5 text-[10px] font-extrabold tracking-wide text-[#fe2c55]">
      <span className="h-1.5 w-1.5 rounded-full bg-[#fe2c55]" />
      LIVE
    </span>
  );
}

export function RolePill({ role }: { role: string }) {
  if (role === "leader") {
    return (
      <span className="rounded-md bg-[rgba(0,210,190,0.15)] px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-[var(--blyp-teal)]">
        BOSS
      </span>
    );
  }
  return (
    <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-[var(--blyp-muted)]">
      MEMBER
    </span>
  );
}

export function Kpi({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="min-w-0 px-3 py-3.5 sm:px-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--blyp-muted)]">
        {label}
      </p>
      <p className="font-display mt-1 text-2xl font-bold tracking-tight sm:text-[1.65rem]">
        {value}
      </p>
      {hint ? (
        <p className="mt-0.5 text-[10px] leading-snug text-[var(--blyp-muted)]">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function SectionTitle({
  children,
  aside,
}: {
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <h2 className="font-display text-lg font-bold tracking-tight">{children}</h2>
      {aside}
    </div>
  );
}

export function PersonLine({
  name,
  handle,
  photoURL,
  size = 36,
  live = false,
  meta,
  trailing,
}: {
  name: string;
  handle?: string;
  photoURL?: string | null;
  size?: number;
  live?: boolean;
  meta?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar name={name} photoURL={photoURL} size={size} liveRing={live} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="truncate text-sm font-semibold">{name}</p>
            {live ? <LivePill /> : null}
          </div>
          {handle ? (
            <p className="truncate text-xs text-[var(--blyp-muted)]">@{handle}</p>
          ) : null}
          {meta}
        </div>
      </div>
      {trailing}
    </div>
  );
}

function csvEscape(v: string | number | null | undefined) {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function exportRosterCsv(team: TeamBundle) {
  const header = [
    "displayName",
    "username",
    "role",
    "isLive",
    "hoursThisWeek",
    "gems",
    "uid",
  ];
  const rows = team.members.map((m) =>
    [
      m.displayName,
      m.username,
      m.role,
      m.isLive ? "yes" : "no",
      m.hoursLive ?? "",
      m.totalEarned ?? 0,
      m.uid,
    ]
      .map(csvEscape)
      .join(","),
  );
  const blob = new Blob([[header.join(","), ...rows].join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${team.name.replace(/[^\w\-]+/g, "_").slice(0, 40)}_roster.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export type DeskTabId =
  | "overview"
  | "roster"
  | "battles"
  | "links"
  | "boards"
  | "recruit";

export type DeskTab = { id: DeskTabId; label: string };

/** Same desk, role-specific chrome. */
export function deskTabsForRole(isBoss: boolean): DeskTab[] {
  if (isBoss) {
    return [
      { id: "overview", label: "Overview" },
      { id: "roster", label: "Roster" },
      { id: "battles", label: "Battles" },
      { id: "links", label: "Agency links" },
      { id: "boards", label: "Boards" },
      { id: "recruit", label: "Recruit & money" },
    ];
  }
  return [
    { id: "overview", label: "Overview" },
    { id: "battles", label: "Battles" },
    { id: "roster", label: "Roster" },
    { id: "boards", label: "Boards" },
  ];
}

export function battleBucket(
  status: string,
): "pending" | "live" | "done" | "other" {
  const st = (status || "").toLowerCase();
  if (
    st === "scheduled" ||
    st === "pending" ||
    st === "open" ||
    st === "invited" ||
    st === "challenge"
  ) {
    return "pending";
  }
  if (st === "live" || st === "active" || st === "in_progress" || st === "ongoing") {
    return "live";
  }
  if (
    st === "done" ||
    st === "completed" ||
    st === "finished" ||
    st === "closed" ||
    st === "scored"
  ) {
    return "done";
  }
  return "other";
}
