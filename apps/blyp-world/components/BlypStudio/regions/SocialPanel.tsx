"use client";

import { RollingNumber } from "../ui/RollingNumber";
import { useStudioState } from "../store/StudioStateContext";

export function SocialPanel() {
  const { socialFeed, jackpotPool, hostGems, activeMode } = useStudioState();

  return (
    <aside className="blyp-studio-region blyp-studio-right blyp-studio-scroll">
      <p className="blyp-studio-label">Social / Economy</p>

      <div className="blyp-studio-placeholder">
        <div className="text-[11px] text-[var(--blyp-muted)]">Jackpot (30%)</div>
        <div className="font-display text-lg font-bold text-[var(--blyp-gold)]">
          <RollingNumber value={jackpotPool} /> coins
        </div>
        <div className="mt-2 text-[11px] text-[var(--blyp-muted)]">Host gems (70%)</div>
        <div className="font-display text-base font-semibold text-[var(--blyp-teal)]">
          {hostGems}
        </div>
      </div>

      <div
        className="blyp-studio-placeholder"
        style={{
          marginBottom: 0,
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div className="mb-2 font-semibold text-[var(--blyp-fog)]">Live feed</div>
        <ul className="blyp-studio-feed">
          {socialFeed.length === 0 && (
            <li className="text-[12px] text-[var(--blyp-muted)]">
              {activeMode === "GRID9"
                ? "Waiting for gift events…"
                : "Enable GRID9 for mock gift stream."}
            </li>
          )}
          {socialFeed.map((evt) => (
            <li key={evt.id} className="blyp-studio-feed-item">
              {evt.text}
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
