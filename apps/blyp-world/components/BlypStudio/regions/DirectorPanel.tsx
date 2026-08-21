"use client";

import "./director-chrome.css";
import {
  OVERLAY_CATALOG,
  type LayoutOrientation,
  type LayoutPreset,
} from "../overlays/catalog";
import { useStudioState, type DeskScene } from "../store/StudioStateContext";

const SCENES: { id: DeskScene; label: string; hint: string }[] = [
  { id: "camera", label: "Camera", hint: "Laptop webcam" },
  { id: "screen", label: "Screen", hint: "Display / game" },
  { id: "screen-pip", label: "Screen + PIP", hint: "Game + face" },
];

const PRESETS: { id: LayoutPreset; label: string }[] = [
  { id: "solo", label: "Solo" },
  { id: "host-top", label: "Host-top" },
  { id: "side-by-side", label: "Side-by-side" },
];

const ORIENTATIONS: { id: LayoutOrientation; label: string; title: string }[] = [
  {
    id: "portrait",
    label: "Phone",
    title: "Portrait · phone watch chrome (one stream)",
  },
  {
    id: "landscape",
    label: "PC / tablet",
    title: "Landscape · PC/tablet watch chrome (one stream)",
  },
];

export function DirectorPanel() {
  const {
    activeMode,
    toggleGrid9Engine,
    auditionQueue,
    gridSlots,
    promoteToGrid,
    kickSlot,
    buybackSlot,
    deskScene,
    setDeskScene,
    layoutOrientation,
    setLayoutOrientation,
    layoutPreset,
    setLayoutPreset,
    overlays,
    toggleOverlay,
    addOverlay,
    matchRemainingMs,
    matchWinnerSlot,
    matchEndReason,
    formatMatchClock,
  } = useStudioState();
  const grid9On = activeMode === "GRID9";
  const occupied = gridSlots.filter(
    (s) => s.kind === "guest" || s.kind === "sentinel" || s.kind === "host",
  );
  const knockedOut = occupied.filter((s) => s.knockedOut);

  return (
    <aside className="blyp-studio-region blyp-studio-left blyp-studio-scroll g9-dir">
      <p className="g9-dir-kicker">Director</p>

      <div className="g9-dir-card">
        <div className="g9-dir-card-title">Scenes</div>
        <div className="blyp-studio-chip-row">
          {SCENES.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`blyp-studio-chip ${deskScene === s.id ? "is-on" : ""}`}
              onClick={() => setDeskScene(s.id)}
              title={s.hint}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="g9-dir-stat-label g9-dir-gap-md">
          Layout · one stream, two chrome truths
        </div>
        <div className="blyp-studio-chip-row">
          {ORIENTATIONS.map((o) => (
            <button
              key={o.id}
              type="button"
              className={`blyp-studio-chip ${layoutOrientation === o.id ? "is-on" : ""}`}
              title={o.title}
              onClick={() => setLayoutOrientation(o.id)}
            >
              {o.label}
            </button>
          ))}
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`blyp-studio-chip ${layoutPreset === p.id ? "is-on" : ""}`}
              onClick={() => setLayoutPreset(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="g9-dir-card">
        <div className="g9-dir-card-title">Overlays</div>
        <ul className="blyp-studio-list">
          {overlays.map((o) => (
            <li key={o.id} className="blyp-studio-list-row">
              <button
                type="button"
                className={`blyp-studio-mini-btn ${o.enabled ? "is-on" : ""}`}
                onClick={() => toggleOverlay(o.id)}
                aria-pressed={o.enabled}
              >
                {o.enabled ? "On" : "Off"}
              </button>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[var(--blyp-fog)]">{o.label}</div>
                <div className="g9-dir-hint">
                  {o.visibleOnCleanFeed ? "Clean feed" : "Director only"}
                </div>
              </div>
            </li>
          ))}
        </ul>
        <div className="blyp-studio-chip-row g9-dir-gap-sm">
          {OVERLAY_CATALOG.filter(
            (c) => !overlays.some((o) => o.kind === c.kind),
          )
            .slice(0, 4)
            .map((c) => (
              <button
                key={c.kind}
                type="button"
                className="blyp-studio-chip"
                onClick={() => addOverlay(c.kind)}
              >
                + {c.label}
              </button>
            ))}
        </div>
      </div>

      <div className="g9-dir-card">
        <div className="g9-dir-card-title">Grid 9 Engine</div>
        <button
          type="button"
          className={`blyp-studio-mode-toggle ${grid9On ? "is-on" : ""}`}
          onClick={toggleGrid9Engine}
        >
          {grid9On ? "GRID9 · ON" : "GRID9 · OFF"}
        </button>
        <p className="g9-dir-hint g9-dir-gap-sm">
          Mode: {activeMode}
          {grid9On && matchRemainingMs != null
            ? ` · ${formatMatchClock(matchRemainingMs)}`
            : ""}
          {matchWinnerSlot != null
            ? ` · winner S${matchWinnerSlot}${matchEndReason ? ` (${matchEndReason})` : ""}`
            : ""}
        </p>
      </div>

      {grid9On && knockedOut.length > 0 && (
        <div className="g9-dir-card">
          <div className="g9-dir-card-title">Buyback (500 → pot)</div>
          <ul className="blyp-studio-list">
            {knockedOut.map((s) => (
              <li key={`bb-${s.index}`} className="blyp-studio-list-row">
                <span className="blyp-studio-avatar">{s.avatarLabel ?? "?"}</span>
                <div className="min-w-0 flex-1 truncate text-[var(--blyp-fog)]">
                  Slot {s.index} · {s.displayName ?? "KO"}
                </div>
                <button
                  type="button"
                  className="blyp-studio-mini-btn is-on"
                  onClick={() => buybackSlot(s.index)}
                  disabled={Boolean(matchEndReason)}
                >
                  Buy back
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="g9-dir-card">
        <div className="g9-dir-card-title">Audition Queue</div>
        <ul className="blyp-studio-list">
          {auditionQueue.length === 0 && (
            <li className="g9-dir-hint">Queue empty</li>
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

      <div className="g9-dir-card is-flush">
        <div className="g9-dir-card-title">Grid slots</div>
        <ul className="blyp-studio-list">
          <li className="blyp-studio-list-row">
            <span className="blyp-studio-avatar">H</span>
            <span className="flex-1 text-[var(--blyp-fog)]">Slot 1 · HOST</span>
          </li>
          {occupied
            .filter((s) => s.kind !== "host")
            .map((s) => (
            <li key={s.index} className="blyp-studio-list-row">
              <span className="blyp-studio-avatar">{s.avatarLabel}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[var(--blyp-fog)]">
                  Slot {s.index} · {s.displayName}
                </div>
                <div className="g9-dir-hint">
                  {s.knockedOut
                    ? `KO · ${s.knockoutTokens} tokens`
                    : `HP ${s.health}/1000 · shields ${s.shields}`}
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
          {occupied.filter((s) => s.kind !== "host").length === 0 && (
            <li className="g9-dir-hint">No guests/sentinels seated</li>
          )}
        </ul>
      </div>
    </aside>
  );
}
