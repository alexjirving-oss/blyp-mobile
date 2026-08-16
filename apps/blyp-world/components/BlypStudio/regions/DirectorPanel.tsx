"use client";

import { useStudioState } from "../store/StudioStateContext";

export function DirectorPanel() {
  const {
    activeMode,
    toggleGrid9Engine,
    auditionQueue,
    gridSlots,
    promoteToGrid,
    kickSlot,
  } = useStudioState();
  const grid9On = activeMode === "GRID9";
  const occupied = gridSlots.filter(
    (s) => s.kind === "guest" || s.kind === "sentinel",
  );

  return (
    <aside className="blyp-studio-region blyp-studio-left blyp-studio-scroll">
      <p className="blyp-studio-label">Director&apos;s Panel</p>

      <div className="blyp-studio-placeholder">
        <div className="mb-2">Grid 9 Engine</div>
        <button
          type="button"
          className={`blyp-studio-mode-toggle ${grid9On ? "is-on" : ""}`}
          onClick={toggleGrid9Engine}
        >
          {grid9On ? "GRID9 · ON" : "GRID9 · OFF"}
        </button>
        <div className="mt-2 text-[11px] text-[var(--blyp-muted)]">
          Mode: {activeMode}
        </div>
      </div>

      <div className="blyp-studio-placeholder">
        <div className="mb-2 font-semibold text-[var(--blyp-fog)]">
          Audition Queue
        </div>
        <ul className="blyp-studio-list">
          {auditionQueue.length === 0 && (
            <li className="text-[11px] text-[var(--blyp-muted)]">Queue empty</li>
          )}
          {auditionQueue.map((a) => (
            <li key={a.id} className="blyp-studio-list-row">
              <span className="blyp-studio-avatar" aria-hidden>
                {a.avatarLabel}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[var(--blyp-fog)]">@{a.username}</div>
                {a.micChecked && (
                  <span className="blyp-studio-badge">Mic Checked</span>
                )}
              </div>
              <button
                type="button"
                className="blyp-studio-mini-btn"
                onClick={() => promoteToGrid(a.id)}
                disabled={!grid9On}
                title={grid9On ? "Promote to first open slot" : "Enable GRID9 first"}
              >
                Promote
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="blyp-studio-placeholder" style={{ marginBottom: 0 }}>
        <div className="mb-2 font-semibold text-[var(--blyp-fog)]">
          Grid slots
        </div>
        <ul className="blyp-studio-list">
          <li className="blyp-studio-list-row text-[11px] text-[var(--blyp-muted)]">
            <span className="blyp-studio-avatar">H</span>
            <span className="flex-1">Slot 1 · HOST</span>
          </li>
          {occupied.map((s) => (
            <li key={s.index} className="blyp-studio-list-row">
              <span className="blyp-studio-avatar">{s.avatarLabel}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[var(--blyp-fog)]">
                  Slot {s.index} · {s.displayName}
                </div>
                <div className="text-[10px] text-[var(--blyp-muted)]">
                  HP {s.health} · 🛡 {s.shields}
                </div>
              </div>
              <button
                type="button"
                className="blyp-studio-mini-btn is-danger"
                onClick={() => kickSlot(s.index)}
              >
                Kick
              </button>
            </li>
          ))}
          {occupied.length === 0 && (
            <li className="text-[11px] text-[var(--blyp-muted)]">
              No guests/sentinels seated
            </li>
          )}
        </ul>
      </div>
    </aside>
  );
}
