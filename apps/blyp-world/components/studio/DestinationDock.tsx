"use client";

import { useEffect, useState } from "react";
import {
  FACEBOOK_DEFAULT_RTMP,
  KICK_DEFAULT_RTMP,
  TWITCH_DEFAULT_RTMP,
  YOUTUBE_DEFAULT_RTMP,
  validateTikTokRtmpCredentials,
} from "@/lib/studioBroadcast";
import {
  companionBlockingHint,
  companionHealth,
  companionPhaseLabel,
  companionSubmitCredentials,
  connectTikTokViaCompanion,
  TIKTOK_COMPANION_START_CMD,
  type TikTokCompanionStatus,
} from "@/lib/studioTikTokCompanion";
import { normalizeTikTokUniqueId } from "@/lib/studioTikTokRoom";

export type DestinationDockProps = {
  busy: boolean;
  tiktokReady: boolean;
  youtubeReady: boolean;
  twitchReady: boolean;
  facebookReady: boolean;
  kickReady: boolean;
  initialTikTokRtmpUrl: string;
  initialTikTokStreamKey: string;
  initialTikTokUniqueId: string;
  initialYouTubeRtmpUrl: string;
  initialYouTubeStreamKey: string;
  initialTwitchRtmpUrl: string;
  initialTwitchStreamKey: string;
  initialFacebookRtmpUrl: string;
  initialFacebookStreamKey: string;
  initialKickRtmpUrl: string;
  initialKickStreamKey: string;
  onDisableTikTok: () => void;
  onDisableYouTube: () => void;
  onDisableTwitch: () => void;
  onDisableFacebook: () => void;
  onDisableKick: () => void;
  onTikTokSaved: (input: {
    rtmpUrl: string;
    streamKey: string;
    uniqueId: string;
  }) => void;
  onYouTubeSaved: (input: { rtmpUrl: string; streamKey: string }) => void;
  onTwitchSaved: (input: { rtmpUrl: string; streamKey: string }) => void;
  onFacebookSaved: (input: { rtmpUrl: string; streamKey: string }) => void;
  onKickSaved: (input: { rtmpUrl: string; streamKey: string }) => void;
};

type KeyPasteId = "youtube" | "twitch" | "facebook" | "kick";
type OpenId = "tiktok" | KeyPasteId | null;

type KeyPasteSpec = {
  id: KeyPasteId;
  label: string;
  defaultUrl: string;
  keyPlaceholder: string;
  logoClass: string;
  panelClass: string;
};

const KEY_PASTE_DESTS: KeyPasteSpec[] = [
  {
    id: "youtube",
    label: "YouTube",
    defaultUrl: YOUTUBE_DEFAULT_RTMP,
    keyPlaceholder: "From YouTube Studio → Go live",
    logoClass: "tls-dest-logo-yt",
    panelClass: "tls-dest-expand-panel-yt",
  },
  {
    id: "twitch",
    label: "Twitch",
    defaultUrl: TWITCH_DEFAULT_RTMP,
    keyPlaceholder: "From Twitch Creator Dashboard",
    logoClass: "tls-dest-logo-tw",
    panelClass: "tls-dest-expand-panel-tw",
  },
  {
    id: "facebook",
    label: "Facebook",
    defaultUrl: FACEBOOK_DEFAULT_RTMP,
    keyPlaceholder: "From Meta Live Producer",
    logoClass: "tls-dest-logo-fb",
    panelClass: "tls-dest-expand-panel-fb",
  },
  {
    id: "kick",
    label: "Kick",
    defaultUrl: KICK_DEFAULT_RTMP,
    keyPlaceholder: "From Kick Creator Dashboard",
    logoClass: "tls-dest-logo-kick",
    panelClass: "tls-dest-expand-panel-kick",
  },
];

const TIKTOK_MARK =
  "M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z";

function TikTokLogo() {
  return (
    <svg viewBox="-2.5 -2.5 29 29" className="tls-dest-logo-svg" aria-hidden>
      <path fill="#25F4EE" d={TIKTOK_MARK} transform="translate(-1.05 -0.7)" />
      <path fill="#FE2C55" d={TIKTOK_MARK} transform="translate(1.05 0.7)" />
      <path fill="#fff" d={TIKTOK_MARK} />
    </svg>
  );
}

function YouTubeLogo() {
  return (
    <svg viewBox="0 0 24 24" className="tls-dest-logo-svg" aria-hidden>
      <path
        fill="#FF0000"
        d="M23.5 6.19a3.02 3.02 0 0 0-2.12-2.14C19.51 3.55 12 3.55 12 3.55s-7.51 0-9.38.5A3.02 3.02 0 0 0 .5 6.19C0 8.07 0 12 0 12s0 3.93.5 5.81a3.02 3.02 0 0 0 2.12 2.14c1.87.5 9.38.5 9.38.5s7.51 0 9.38-.5a3.02 3.02 0 0 0 2.12-2.14C24 15.93 24 12 24 12s0-3.93-.5-5.81z"
      />
      <path fill="#fff" d="M9.55 15.57V8.43L15.82 12z" />
    </svg>
  );
}

function TwitchLogo() {
  return (
    <svg viewBox="0 0 24 24" className="tls-dest-logo-svg" aria-hidden>
      <path
        fill="#9146FF"
        d="M6 0 1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"
      />
      <path fill="#fff" d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714z" />
    </svg>
  );
}

function FacebookLogo() {
  return (
    <svg viewBox="0 0 24 24" className="tls-dest-logo-svg" aria-hidden>
      <path
        fill="#1877F2"
        d="M24 12.044C24 5.417 18.627.044 12 .044S0 5.417 0 12.044c0 5.628 3.874 10.35 9.101 11.647v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.911 8.911 0 0 0-.653-.036c-.978 0-1.772.247-2.219.798-.449.549-.535 1.362-.535 2.291v1.082h3.863l-.528 3.667h-3.335v7.98C19.396 23.238 24 18.179 24 12.044z"
      />
    </svg>
  );
}

function KickLogo() {
  return (
    <svg viewBox="0 0 24 24" className="tls-dest-logo-svg" aria-hidden>
      <path
        fill="#53FC18"
        d="M1.2 0h7.05v7.8L15.6 0H24l-9.15 10.35L24 24h-8.4L8.25 13.8V24H1.2z"
      />
    </svg>
  );
}

function KeyPasteLogo({ id }: { id: KeyPasteId }) {
  if (id === "youtube") return <YouTubeLogo />;
  if (id === "twitch") return <TwitchLogo />;
  if (id === "facebook") return <FacebookLogo />;
  return <KickLogo />;
}

function logoBtnClass(ready: boolean, logoClass: string): string {
  return ready
    ? `tls-dest-logo-btn tls-dest-logo-btn-lit ${logoClass}`
    : `tls-dest-logo-btn tls-dest-logo-btn-dim ${logoClass}`;
}

export function DestinationDock({
  busy,
  tiktokReady,
  youtubeReady,
  twitchReady,
  facebookReady,
  kickReady,
  initialTikTokRtmpUrl,
  initialTikTokStreamKey,
  initialTikTokUniqueId,
  initialYouTubeRtmpUrl,
  initialYouTubeStreamKey,
  initialTwitchRtmpUrl,
  initialTwitchStreamKey,
  initialFacebookRtmpUrl,
  initialFacebookStreamKey,
  initialKickRtmpUrl,
  initialKickStreamKey,
  onDisableTikTok,
  onDisableYouTube,
  onDisableTwitch,
  onDisableFacebook,
  onDisableKick,
  onTikTokSaved,
  onYouTubeSaved,
  onTwitchSaved,
  onFacebookSaved,
  onKickSaved,
}: DestinationDockProps) {
  const ready: Record<KeyPasteId, boolean> = {
    youtube: youtubeReady,
    twitch: twitchReady,
    facebook: facebookReady,
    kick: kickReady,
  };
  const onSaved: Record<
    KeyPasteId,
    (input: { rtmpUrl: string; streamKey: string }) => void
  > = {
    youtube: onYouTubeSaved,
    twitch: onTwitchSaved,
    facebook: onFacebookSaved,
    kick: onKickSaved,
  };
  const onDisable: Record<KeyPasteId, () => void> = {
    youtube: onDisableYouTube,
    twitch: onDisableTwitch,
    facebook: onDisableFacebook,
    kick: onDisableKick,
  };

  const [open, setOpen] = useState<OpenId>(null);
  const [ttUrl, setTtUrl] = useState(initialTikTokRtmpUrl);
  const [ttKey, setTtKey] = useState(initialTikTokStreamKey);
  const [ttHandle, setTtHandle] = useState(initialTikTokUniqueId);
  const [draftUrl, setDraftUrl] = useState("");
  const [draftKey, setDraftKey] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [companionBusy, setCompanionBusy] = useState(false);
  const [companionHint, setCompanionHint] = useState<string | null>(null);
  const [companionStatus, setCompanionStatus] =
    useState<TikTokCompanionStatus | null>(null);
  const [companionOffline, setCompanionOffline] = useState(false);
  const [showPasteFallback, setShowPasteFallback] = useState(false);
  const [pasteBusy, setPasteBusy] = useState(false);

  const seedUrl =
    open === "youtube"
      ? initialYouTubeRtmpUrl || YOUTUBE_DEFAULT_RTMP
      : open === "twitch"
        ? initialTwitchRtmpUrl || TWITCH_DEFAULT_RTMP
        : open === "facebook"
          ? initialFacebookRtmpUrl || FACEBOOK_DEFAULT_RTMP
          : open === "kick"
            ? initialKickRtmpUrl || KICK_DEFAULT_RTMP
            : "";
  const seedKey =
    open === "youtube"
      ? initialYouTubeStreamKey
      : open === "twitch"
        ? initialTwitchStreamKey
        : open === "facebook"
          ? initialFacebookStreamKey
          : open === "kick"
            ? initialKickStreamKey
            : "";

  useEffect(() => {
    if (open !== "tiktok") return;
    setTtUrl(initialTikTokRtmpUrl);
    setTtKey(initialTikTokStreamKey);
    setTtHandle(initialTikTokUniqueId);
    setLocalError(null);
    setCompanionHint(null);
    setCompanionStatus(null);
    setCompanionOffline(false);
    setShowPasteFallback(false);
  }, [open, initialTikTokRtmpUrl, initialTikTokStreamKey, initialTikTokUniqueId]);

  useEffect(() => {
    if (!open || open === "tiktok") return;
    setDraftUrl(seedUrl);
    setDraftKey(seedKey);
    setLocalError(null);
  }, [open, seedUrl, seedKey]);

  const toggle = (id: Exclude<OpenId, null>) => {
    setOpen((cur) => (cur === id ? null : id));
    setLocalError(null);
  };

  const saveTikTokCredentials = (input: {
    rtmpUrl: string;
    streamKey: string;
    uniqueId: string;
  }) => {
    onTikTokSaved({
      rtmpUrl: input.rtmpUrl.trim().replace(/\/+$/, ""),
      streamKey: input.streamKey.trim(),
      uniqueId: input.uniqueId,
    });
    setOpen(null);
    setCompanionHint(null);
    setLocalError(null);
  };

  const onTikTokOk = () => {
    setLocalError(null);
    const v = validateTikTokRtmpCredentials(ttUrl, ttKey);
    if (!v.ok) {
      setLocalError(v.message);
      return;
    }
    const handle = normalizeTikTokUniqueId(ttHandle);
    if (!handle) {
      setLocalError("Add your TikTok @handle");
      return;
    }
    saveTikTokCredentials({
      rtmpUrl: ttUrl,
      streamKey: ttKey,
      uniqueId: handle,
    });
  };

  const applyCompanionCredentials = (status: TikTokCompanionStatus) => {
    const nextUrl = status.rtmpUrl || "";
    const nextKey = status.streamKey || "";
    const nextHandle = status.handle || ttHandle;

    setTtUrl(nextUrl);
    setTtKey(nextKey);
    if (status.handle) setTtHandle(status.handle);

    const handle = normalizeTikTokUniqueId(nextHandle);
    if (!handle) {
      setCompanionHint("RTMP ready — add your @handle below, then click OK.");
      setShowPasteFallback(false);
      return;
    }

    const v = validateTikTokRtmpCredentials(nextUrl, nextKey);
    if (!v.ok) {
      setLocalError(v.message);
      setShowPasteFallback(true);
      return;
    }

    saveTikTokCredentials({
      rtmpUrl: nextUrl,
      streamKey: nextKey,
      uniqueId: handle,
    });
  };

  const onConnectTikTok = async () => {
    if (companionBusy || busy) return;
    setCompanionBusy(true);
    setLocalError(null);
    setCompanionHint(null);
    setCompanionOffline(false);
    setShowPasteFallback(false);
    setCompanionStatus(null);

    const healthy = await companionHealth();
    if (!healthy) {
      setCompanionOffline(true);
      setLocalError(`Companion not running on this PC`);
      setCompanionBusy(false);
      return;
    }

    try {
      const result = await connectTikTokViaCompanion({
        timeoutMs: 120_000,
        onStatus: (status) => {
          setCompanionStatus(status);
          if (status.phase === "watching") {
            setShowPasteFallback(true);
          }
        },
      });

      if (result.status) setCompanionStatus(result.status);

      if (!result.ok) {
        if (result.reason === "companion_offline") {
          setCompanionOffline(true);
          setLocalError("Companion not running on this PC");
          return;
        }
        if (result.reason === "error") {
          setLocalError(result.message);
          if (result.status?.phase === "watching") {
            setShowPasteFallback(true);
            setCompanionHint(companionBlockingHint(result.status));
          }
          return;
        }
        if (result.reason === "timeout") {
          setShowPasteFallback(true);
          setCompanionHint(
            companionBlockingHint(result.status || null) || result.message,
          );
          return;
        }
        setLocalError(result.message);
        return;
      }

      applyCompanionCredentials(result.status);
    } finally {
      setCompanionBusy(false);
    }
  };

  const onPasteCredentials = async () => {
    if (pasteBusy || busy) return;
    setPasteBusy(true);
    setLocalError(null);
    try {
      const healthy = await companionHealth();
      if (!healthy) {
        setCompanionOffline(true);
        setLocalError(`Companion not running on this PC`);
        return;
      }

      const v = validateTikTokRtmpCredentials(ttUrl, ttKey);
      if (!v.ok) {
        setLocalError(v.message);
        return;
      }

      const status = await companionSubmitCredentials({
        rtmpUrl: ttUrl.trim().replace(/\/+$/, ""),
        streamKey: ttKey.trim(),
        handle: ttHandle.trim() || undefined,
      });
      if (!status?.connected) {
        setLocalError(status?.error || "Could not save credentials to companion");
        return;
      }

      setCompanionStatus(status);
      applyCompanionCredentials(status);
    } finally {
      setPasteBusy(false);
    }
  };

  const onKeyPasteOk = (id: KeyPasteId) => {
    setLocalError(null);
    const v = validateTikTokRtmpCredentials(draftUrl, draftKey);
    if (!v.ok) {
      setLocalError(v.message);
      return;
    }
    onSaved[id]({
      rtmpUrl: draftUrl.trim().replace(/\/+$/, ""),
      streamKey: draftKey.trim(),
    });
    setOpen(null);
  };

  const openSpec = KEY_PASTE_DESTS.find((d) => d.id === open) || null;

  return (
    <section className="tls-dest tls-dest-dock" aria-label="Streaming destinations">
      <p className="tls-panel-label">Streaming destinations</p>
      <div className="tls-dest-logos">
        <div
          className="tls-dest-logo-btn tls-dest-logo-btn-lit tls-dest-logo-blyp"
          aria-label="Blyp — always on"
          title="Blyp"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/blyp-app-tile-512.png" alt="" />
        </div>

        <button
          type="button"
          className={logoBtnClass(tiktokReady, "tls-dest-logo-tt")}
          aria-label={tiktokReady ? "TikTok — on" : "TikTok — off"}
          aria-expanded={open === "tiktok"}
          title="TikTok"
          onClick={() => toggle("tiktok")}
        >
          <TikTokLogo />
        </button>

        {KEY_PASTE_DESTS.map((dest) => {
          const isReady = ready[dest.id];
          return (
            <button
              key={dest.id}
              type="button"
              className={logoBtnClass(isReady, dest.logoClass)}
              aria-label={isReady ? `${dest.label} — on` : `${dest.label} — off`}
              aria-expanded={open === dest.id}
              title={dest.label}
              onClick={() => toggle(dest.id)}
            >
              <KeyPasteLogo id={dest.id} />
            </button>
          );
        })}
      </div>

      {open === "tiktok" ? (
        <form
          className="tls-dest-expand-panel"
          onSubmit={(e) => {
            e.preventDefault();
            onTikTokOk();
          }}
        >
          <div className="tls-dest-connect-row">
            <button
              type="button"
              className="tls-go tls-dest-connect-btn"
              disabled={busy || companionBusy || pasteBusy}
              onClick={() => void onConnectTikTok()}
            >
              {companionBusy ? "Connecting…" : "Connect TikTok"}
            </button>
            {tiktokReady ? (
              <span className="tls-dest-connected" role="status">
                Connected
              </span>
            ) : companionStatus?.connected ? (
              <span className="tls-dest-connected" role="status">
                Connected
              </span>
            ) : companionBusy ? (
              <span className="tls-dest-connect-phase" role="status">
                {companionStatus
                  ? companionPhaseLabel(companionStatus)
                  : "Connecting…"}
              </span>
            ) : null}
          </div>
          {companionOffline ? (
            <div className="tls-dest-companion-offline" role="alert">
              <p className="tls-dest-companion-offline-title">Companion not running</p>
              <p className="tls-dest-connect-hint">
                Auto-connect needs the local helper. Start it, then click Connect TikTok
                again — or paste Server URL + Stream key from TikTok Live Studio (Go LIVE →
                Stream settings) below and click OK.
              </p>
              <code className="tls-dest-companion-cmd">{TIKTOK_COMPANION_START_CMD}</code>
            </div>
          ) : null}
          {companionHint ? (
            <p className="tls-dest-connect-hint" role="status">
              {companionHint}
            </p>
          ) : null}
          {!companionOffline &&
          companionStatus &&
          !companionStatus.connected &&
          (companionBusy || showPasteFallback) ? (
            <p className="tls-dest-connect-hint" role="status">
              {companionPhaseLabel(companionStatus)}
            </p>
          ) : null}
          <label className="tls-preflight-field">
            <span>TikTok @handle</span>
            <input
              type="text"
              value={ttHandle}
              onChange={(e) => setTtHandle(e.target.value)}
              placeholder="@yourhandle"
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
            />
          </label>
          <label className="tls-preflight-field">
            <span>Server URL</span>
            <input
              type="text"
              value={ttUrl}
              onChange={(e) => setTtUrl(e.target.value)}
              placeholder="rtmp://push.tiktok.com/live/..."
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
            />
          </label>
          <label className="tls-preflight-field">
            <span>Stream key</span>
            <input
              type="password"
              value={ttKey}
              onChange={(e) => setTtKey(e.target.value)}
              placeholder="Stream key"
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
            />
          </label>
          {showPasteFallback && !companionOffline ? (
            <div className="tls-dest-paste-fallback">
              <p className="tls-dest-paste-fallback-copy">
                Live Studio has not written credentials yet. Open TikTok Live Studio → Go LIVE →
                Stream settings, or paste Server URL + Stream key here and Save / OK.
              </p>
              <button
                type="button"
                className="tls-go tls-dest-paste-save"
                disabled={busy || pasteBusy || companionBusy}
                onClick={() => void onPasteCredentials()}
              >
                {pasteBusy ? "Saving…" : "Save TikTok credentials"}
              </button>
            </div>
          ) : null}
          {localError ? (
            <p className="tls-preflight-error" role="alert">
              {localError}
            </p>
          ) : null}
          <div className="tls-dest-expand-actions">
            {tiktokReady ? (
              <button
                type="button"
                className="tls-dest-off"
                disabled={busy}
                onClick={() => {
                  onDisableTikTok();
                  setOpen(null);
                }}
              >
                Off
              </button>
            ) : (
              <span />
            )}
            <div className="tls-preflight-actions">
              <button
                type="button"
                className="tls-pill"
                disabled={busy}
                onClick={() => setOpen(null)}
              >
                Cancel
              </button>
              <button type="submit" className="tls-go" disabled={busy}>
                OK
              </button>
            </div>
          </div>
        </form>
      ) : null}

      {openSpec ? (
        <form
          className={`tls-dest-expand-panel ${openSpec.panelClass}`}
          onSubmit={(e) => {
            e.preventDefault();
            onKeyPasteOk(openSpec.id);
          }}
        >
          <label className="tls-preflight-field">
            <span>Server URL</span>
            <input
              type="text"
              value={draftUrl}
              onChange={(e) => setDraftUrl(e.target.value)}
              placeholder={openSpec.defaultUrl}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
            />
          </label>
          <label className="tls-preflight-field">
            <span>Stream key</span>
            <input
              type="password"
              value={draftKey}
              onChange={(e) => setDraftKey(e.target.value)}
              placeholder={openSpec.keyPlaceholder}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
            />
          </label>
          {localError ? (
            <p className="tls-preflight-error" role="alert">
              {localError}
            </p>
          ) : null}
          <div className="tls-dest-expand-actions">
            {ready[openSpec.id] ? (
              <button
                type="button"
                className="tls-dest-off"
                disabled={busy}
                onClick={() => {
                  onDisable[openSpec.id]();
                  setOpen(null);
                }}
              >
                Off
              </button>
            ) : (
              <span />
            )}
            <div className="tls-preflight-actions">
              <button
                type="button"
                className="tls-pill"
                disabled={busy}
                onClick={() => setOpen(null)}
              >
                Cancel
              </button>
              <button type="submit" className="tls-go" disabled={busy}>
                OK
              </button>
            </div>
          </div>
        </form>
      ) : null}
    </section>
  );
}
