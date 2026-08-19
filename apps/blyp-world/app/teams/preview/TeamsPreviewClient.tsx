"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { buildDemoTeamBundle } from "@/lib/teams";
import { TeamDashboard } from "@/components/teams/TeamDashboard";
import "@/components/hub-neon.css";

/** Interactive desk preview for applicants + screenshot capture. */
export function TeamsPreviewClient() {
  const [role, setRole] = useState<"boss" | "member">("boss");
  const team = useMemo(
    () => buildDemoTeamBundle({ asMember: role === "member" }),
    [role],
  );
  return (
    <div className="hub hub-wide" style={{ paddingTop: 0, maxWidth: "none" }}>
      <div className="hub-banner is-wait">
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
