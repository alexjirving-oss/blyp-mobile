"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { STING_PAD } from "@/components/BlypStudio/audio/StudioAudioEngine";
import {
  STUDIO_OVERLAYS,
  TOP_LAYOUT_PRESETS,
} from "@/lib/studioDualView";
import {
  postStudioDeckCommand,
  type StudioDeckCommand,
} from "@/lib/studioDeckBus";

type DeckCmd = StudioDeckCommand extends infer C
  ? C extends StudioDeckCommand
    ? Omit<C, "at">
    : never
  : never;

const SCENES = [
  ["camera", "Camera", "scene:camera"],
  ["screen", "Screen", "scene:screen"],
  ["screen-pip", "Cam PIP", "scene:screen-pip"],
] as const;

function commandFromDeckParam(raw: string): DeckCmd | null {
  const [kind, arg] = raw.split(":");
  switch (kind) {
    case "sting":
      return arg ? { type: "sting", id: arg } : null;
    case "scene":
      if (arg === "camera" || arg === "screen" || arg === "screen-pip") {
        return { type: "scene", scene: arg };
      }
      return null;
    case "stop":
    case "stop-music":
      return { type: "stop-music" };
    case "layout": {
      const i = Number(arg);
      return Number.isInteger(i) && i >= 0 ? { type: "layout", presetIndex: i } : null;
    }
    case "overlay":
      return arg ? { type: "overlay-toggle", id: arg } : null;
    case "mic":
    case "mic-toggle":
      return { type: "mic-toggle" };
    case "cam":
    case "cam-toggle":
      return { type: "cam-toggle" };
    case "live":
    case "go-live":
      return { type: "go-live" };
    case "end":
    case "end-live":
      return { type: "end-live" };
    default:
      return null;
  }
}

function labelFor(cmd: DeckCmd): string {
  switch (cmd.type) {
    case "sting":
      return STING_PAD.find((s) => s.id === cmd.id)?.name ?? cmd.id;
    case "stop-music":
      return "Stop music";
    case "scene":
      return SCENES.find(([id]) => id === cmd.scene)?.[1] ?? cmd.scene;
    case "layout": {
      const p = TOP_LAYOUT_PRESETS[cmd.presetIndex];
      return p ? p.label : `Layout ${cmd.presetIndex + 1}`;
    }
    case "overlay-toggle":
      return STUDIO_OVERLAYS.find((o) => o.id === cmd.id)?.label ?? cmd.id;
    case "mic-toggle":
      return "Mic toggle";
    case "cam-toggle":
      return "Cam toggle";
    case "go-live":
      return "GO LIVE → Studio";
    case "end-live":
      return "END STREAM → Studio";
    default:
      return "Sent";
  }
}

function deckQueryFor(cmd: DeckCmd): string {
  switch (cmd.type) {
    case "sting":
      return `sting:${cmd.id}`;
    case "stop-music":
      return "stop";
    case "scene":
      return `scene:${cmd.scene}`;
    case "layout":
      return `layout:${cmd.presetIndex}`;
    case "overlay-toggle":
      return `overlay:${cmd.id}`;
    case "mic-toggle":
      return "mic";
    case "cam-toggle":
      return "cam";
    case "go-live":
      return "go-live";
    case "end-live":
      return "end";
    default:
      return "";
  }
}

/**
 * Large-target companion for Elgato Stream Deck (Website / Multi Action)
 * and phones. Posts commands the LIVE Studio booth already listens to.
 * Does not encode or start a second stream.
 */
export function StudioDeckPageClient() {
  const [flash, setFlash] = useState<string | null>(null);
  const [hot, setHot] = useState<string | null>(null);
  const [origin, setOrigin] = useState("https://blyp.world");

  const deckUrl = useMemo(() => `${origin}/live/studio/deck/`, [origin]);

  const fire = useCallback((cmd: DeckCmd) => {
    postStudioDeckCommand(cmd);
    const key = deckQueryFor(cmd);
    const label = labelFor(cmd);
    setHot(key);
    setFlash(label);
    window.setTimeout(() => {
      setFlash(null);
      setHot(null);
    }, 900);
  }, []);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const deck = url.searchParams.get("deck");
      if (!deck) return;
      const cmd = commandFromDeckParam(deck);
      url.searchParams.delete("deck");
      window.history.replaceState({}, "", url.pathname + url.search + url.hash);
      if (cmd) fire(cmd);
      else {
        setFlash(`Unknown: ${deck}`);
        window.setTimeout(() => setFlash(null), 1400);
      }
    } catch {
      /* ignore */
    }
  }, [fire]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
        return;
      }
      if (e.key >= "1" && e.key <= "6") {
        const pad = STING_PAD[Number(e.key) - 1];
        if (pad) {
          e.preventDefault();
          fire({ type: "sting", id: pad.id });
        }
        return;
      }
      if (e.key === "0") {
        e.preventDefault();
        fire({ type: "stop-music" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fire]);

  const copy = useCallback(async (text: string, ok = "Copied") => {
    try {
      await navigator.clipboard.writeText(text);
      setFlash(ok);
    } catch {
      setFlash("Copy failed");
    }
    window.setTimeout(() => setFlash(null), 900);
  }, []);

  const deep = (q: string) => `${deckUrl}?deck=${q}`;

  return (
    <div className="sdp">
      <header className="sdp-top">
        <Link href="/live/studio/" className="sdp-logo" aria-label="LIVE Studio">
          <span>blyp</span>
          <span className="sdp-logo-dot" aria-hidden />
        </Link>
        <span className="sdp-title">Studio Deck</span>
        <span className="sdp-badge">Companion</span>
        <button
          type="button"
          className="sdp-copy"
          onClick={() => void copy(deckUrl, "Page URL copied")}
        >
          Copy URL
        </button>
      </header>

      {flash ? (
        <p className="sdp-toast" role="status" aria-live="polite">
          {flash}
        </p>
      ) : null}

      <div className="sdp-body">
        <p className="sdp-lead">
          Keep <strong>LIVE Studio</strong> open in another tab on this browser.
          Pads fire there over BroadcastChannel.{" "}
          <strong>This page does not encode or GO LIVE on its own.</strong>
        </p>

        <h2 className="sdp-h">Soundboard</h2>
        <div className="sdp-grid">
          {STING_PAD.map((s) => {
            const q = `sting:${s.id}`;
            return (
              <button
                key={s.id}
                type="button"
                className={hot === q ? "sdp-pad is-hot" : "sdp-pad"}
                title={deep(q)}
                onClick={() => fire({ type: "sting", id: s.id })}
              >
                <span className="sdp-pad-key">{s.hint}</span>
                <span className="sdp-pad-name">{s.name}</span>
              </button>
            );
          })}
          <button
            type="button"
            className={
              hot === "stop" ? "sdp-pad sdp-pad-warn is-hot" : "sdp-pad sdp-pad-warn"
            }
            title={deep("stop")}
            onClick={() => fire({ type: "stop-music" })}
          >
            <span className="sdp-pad-key">0</span>
            <span className="sdp-pad-name">Stop music</span>
          </button>
        </div>

        <h2 className="sdp-h">Scenes</h2>
        <div className="sdp-grid">
          {SCENES.map(([scene, label, q]) => (
            <button
              key={scene}
              type="button"
              className={hot === q ? "sdp-pad is-hot" : "sdp-pad"}
              title={deep(q)}
              onClick={() => fire({ type: "scene", scene })}
            >
              <span className="sdp-pad-name">{label}</span>
            </button>
          ))}
        </div>

        <h2 className="sdp-h">Layouts</h2>
        <div className="sdp-grid">
          {TOP_LAYOUT_PRESETS.map((preset, i) => {
            const q = `layout:${i}`;
            return (
              <button
                key={preset.id}
                type="button"
                className={hot === q ? "sdp-pad is-hot" : "sdp-pad"}
                title={deep(q)}
                onClick={() => fire({ type: "layout", presetIndex: i })}
              >
                <span className="sdp-pad-key">F{i + 1}</span>
                <span className="sdp-pad-name">{preset.label}</span>
              </button>
            );
          })}
        </div>

        <h2 className="sdp-h">Overlays</h2>
        <div className="sdp-grid">
          {STUDIO_OVERLAYS.map((o) => {
            const q = `overlay:${o.id}`;
            return (
              <button
                key={o.id}
                type="button"
                className={hot === q ? "sdp-pad is-hot" : "sdp-pad"}
                title={deep(q)}
                onClick={() => fire({ type: "overlay-toggle", id: o.id })}
              >
                <span className="sdp-pad-name">{o.label}</span>
                <span className="sdp-pad-sub">Toggle</span>
              </button>
            );
          })}
        </div>

        <h2 className="sdp-h">Booth remote</h2>
        <div className="sdp-grid">
          <button
            type="button"
            className={hot === "mic" ? "sdp-pad is-hot" : "sdp-pad"}
            title={deep("mic")}
            onClick={() => fire({ type: "mic-toggle" })}
          >
            <span className="sdp-pad-name">Mic toggle</span>
          </button>
          <button
            type="button"
            className={hot === "cam" ? "sdp-pad is-hot" : "sdp-pad"}
            title={deep("cam")}
            onClick={() => fire({ type: "cam-toggle" })}
          >
            <span className="sdp-pad-name">Cam toggle</span>
          </button>
          <button
            type="button"
            className={
              hot === "go-live"
                ? "sdp-pad sdp-pad-live is-hot"
                : "sdp-pad sdp-pad-live"
            }
            title={deep("go-live")}
            onClick={() => fire({ type: "go-live" })}
          >
            <span className="sdp-pad-name">GO LIVE</span>
            <span className="sdp-pad-sub">Studio tab</span>
          </button>
          <button
            type="button"
            className={
              hot === "end" ? "sdp-pad sdp-pad-warn is-hot" : "sdp-pad sdp-pad-warn"
            }
            title={deep("end")}
            onClick={() => fire({ type: "end-live" })}
          >
            <span className="sdp-pad-name">END STREAM</span>
            <span className="sdp-pad-sub">Studio tab</span>
          </button>
        </div>

        <details className="sdp-howto">
          <summary>Stream Deck Website actions</summary>
          <ol>
            <li>Open LIVE Studio in this browser profile first.</li>
            <li>
              Drag <strong>Website</strong> onto a key. URL: <code>{deckUrl}</code>{" "}
              for the full pad, or a deep link from the chips below.
            </li>
            <li>
              Deep links post to the booth on load — they do not start a second
              encoder.
            </li>
          </ol>
          <div className="sdp-links">
            {[
              "sting:airhorn",
              "scene:screen-pip",
              "stop",
              "overlay:gifts",
              "go-live",
              "end",
            ].map((q) => (
              <button
                key={q}
                type="button"
                className="sdp-chip"
                onClick={() => void copy(deep(q), `Copied ${q}`)}
              >
                {q}
              </button>
            ))}
          </div>
          <p>
            <Link href="/live/studio/">← LIVE Studio</Link>
          </p>
        </details>
      </div>
    </div>
  );
}
