"use client";

import "./director-chrome.css";
import { RollingNumber } from "../ui/RollingNumber";
import { useStudioState } from "../store/StudioStateContext";

export function TopBar() {
  const {
    isLive,
    streamHealth,
    jackpotPool,
    hostGems,
    activeMode,
    socketStatus,
    economySource,
    matchRemainingMs,
    matchWinnerSlot,
    matchEndReason,
    formatMatchClock,
  } = useStudioState();

  return (
    <header className="blyp-studio-region blyp-studio-top g9-dir">
      <div className="blyp-studio-top-cluster">
        <p className="g9-dir-brand">
          BLYP
          <span className="g9-dir-brand-dot" aria-hidden />
          <span className="g9-dir-brand-sub">Studio</span>
        </p>
        <span
          className={`g9-dir-live ${isLive ? "is-live" : "is-offline"}`}
        >
          <span
            className={`blyp-studio-live-dot ${isLive ? "is-live" : "is-offline"}`}
            aria-hidden
          />
          {isLive ? "Live" : "Offline"}
        </span>
        <span className="g9-dir-meta">Health {streamHealth}</span>
        <span className="g9-dir-meta is-mode">{activeMode}</span>
        <span className="g9-dir-meta">
          Sock {socketStatus} · Eco {economySource}
        </span>
      </div>
      <div className="blyp-studio-top-cluster">
        {activeMode === "GRID9" && matchRemainingMs != null && (
          <span
            className="blyp-studio-economy-chip"
            title="Match clock (60:00 default)"
          >
            Clock{" "}
            <strong>{formatMatchClock(matchRemainingMs)}</strong>
            {matchWinnerSlot != null && (
              <span className="ml-2 text-[var(--blyp-gold)]">
                · Win S{matchWinnerSlot}
                {matchEndReason === "last_standing" ? " (last)" : " (finale)"}
              </span>
            )}
          </span>
        )}
        <span className="blyp-studio-economy-chip">
          Jackpot
          <RollingNumber
            value={jackpotPool}
            className="font-display font-bold text-[var(--blyp-gold)]"
          />
        </span>
        <span className="blyp-studio-economy-chip">
          Gems{" "}
          <strong className="text-[var(--blyp-teal)]">{hostGems}</strong>
        </span>
      </div>
    </header>
  );
}
