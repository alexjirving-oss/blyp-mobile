"use client";

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
  } = useStudioState();

  return (
    <header className="blyp-studio-region blyp-studio-top">
      <div className="blyp-studio-top-cluster">
        <p className="blyp-studio-label" style={{ margin: 0 }}>
          BlypStudio
        </p>
        <span
          className={`blyp-studio-live-dot ${isLive ? "is-live" : "is-offline"}`}
          aria-hidden
        />
        <span className="blyp-studio-status-pill">
          {isLive ? "Live" : "Offline"}
        </span>
        <span className="blyp-studio-placeholder" style={{ margin: 0 }}>
          Health: {streamHealth}
        </span>
        <span className="blyp-studio-placeholder" style={{ margin: 0 }}>
          {activeMode}
        </span>
        <span className="blyp-studio-placeholder" style={{ margin: 0 }}>
          Sock: {socketStatus} · Eco: {economySource}
        </span>
      </div>
      <div className="blyp-studio-top-cluster">
        <span className="blyp-studio-economy-chip">
          Jackpot Pool{" "}
          <RollingNumber
            value={jackpotPool}
            className="font-display font-bold text-[var(--blyp-gold)]"
          />
        </span>
        <span className="blyp-studio-economy-chip">
          Host Gems{" "}
          <strong className="text-[var(--blyp-teal)]">{hostGems}</strong>
        </span>
        <span className="blyp-studio-placeholder" style={{ margin: 0 }}>
          Settings
        </span>
      </div>
    </header>
  );
}
