"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { buildDemoTeamBundle } from "@/lib/teams";
import { TeamDashboard } from "@/components/teams/TeamDashboard";

/** Interactive desk preview for applicants + screenshot capture. */
export function TeamsPreviewClient() {
  const [role, setRole] = useState<"boss" | "member">("boss");
  const team = useMemo(
    () => buildDemoTeamBundle({ asMember: role === "member" }),
    [role],
  );
  return (
    <div>
      <div className="border-b border-[var(--blyp-gold)]/30 bg-[rgba(232,196,124,0.08)] px-5 py-3 text-center text-sm md:px-8">
        <span className="font-semibold text-[var(--blyp-gold)]">Preview</span>
        {" — "}
        sample roster (not live data).{" "}
        <Link href="/teams/" className="font-semibold text-[var(--blyp-teal)]">
          ← Back to Teams
        </Link>
        <span className="mx-2 text-[var(--blyp-muted)]">·</span>
        <button
          type="button"
          onClick={() => setRole("boss")}
          className={`mx-1 text-xs font-bold ${
            role === "boss"
              ? "text-[var(--blyp-teal)]"
              : "text-[var(--blyp-muted)]"
          }`}
        >
          Boss view
        </button>
        <button
          type="button"
          onClick={() => setRole("member")}
          className={`mx-1 text-xs font-bold ${
            role === "member"
              ? "text-[var(--blyp-teal)]"
              : "text-[var(--blyp-muted)]"
          }`}
        >
          Member view
        </button>
      </div>
      <TeamDashboard
        team={team}
        onRefresh={() => undefined}
        busy={false}
        preview
      />
    </div>
  );
}
