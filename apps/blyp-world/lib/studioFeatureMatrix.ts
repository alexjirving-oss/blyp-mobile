/**
 * LIVE Studio product matrix (OBS + TikFinity + TikTok Live Studio DNA).
 * Source of truth for booth IA + Capabilities panel — keep statuses honest.
 */

export type StudioFeatureStatus =
  | "DONE"
  | "PARTIAL"
  | "MISSING"
  | "BLOCKED";

export type StudioMatrixPillarId =
  | "compositing"
  | "triggers"
  | "broadcast"
  | "audio";

export type StudioMatrixItem = {
  id: string;
  label: string;
  status: StudioFeatureStatus;
  /** Short honest note — what works / what’s stubbed / why blocked */
  note: string;
};

export type StudioMatrixPillar = {
  id: StudioMatrixPillarId;
  title: string;
  blurb: string;
  items: StudioMatrixItem[];
};

export const STUDIO_FEATURE_MATRIX: StudioMatrixPillar[] = [
  {
    id: "compositing",
    title: "Scenes & sources",
    blurb: "OBS DNA — program layers, scenes, guests as sources",
    items: [
      {
        id: "canvas-layers",
        label: "Unlimited canvas layering (video, images, screen, web overlays)",
        status: "PARTIAL",
        note: "Camera + screen + PIP + HTML overlay widgets; no freeform image/web layer stack",
      },
      {
        id: "dnd-builder",
        label: "Drag-and-drop scene builder (resize, crop, position)",
        status: "PARTIAL",
        note: "Overlay widgets drag on stage; sources are mode buttons, not freeform crop/resize",
      },
      {
        id: "scene-collections",
        label: "Scene collections & switching with crossfade",
        status: "PARTIAL",
        note: "Named program scenes + soft crossfade on switch; no multi-collection folders",
      },
      {
        id: "chroma-ai",
        label: "Chroma key / AI background removal",
        status: "MISSING",
        note: "Not implemented — stub only in Capabilities",
      },
      {
        id: "source-masks",
        label: "Dynamic source masking (circle, rounded rect)",
        status: "PARTIAL",
        note: "PIP uses rounded-rect clip in desk compositor; no circle / host masks UI",
      },
      {
        id: "multi-guest-sources",
        label: "Multi-guest as distinct isolatable sources",
        status: "PARTIAL",
        note: "Guest tiles + accept/reject queue; not per-guest MediaStream mix/publish isolation",
      },
    ],
  },
  {
    id: "triggers",
    title: "Alerts & triggers",
    blurb: "TikFinity DNA — gifts, TTS, widgets, queue",
    items: [
      {
        id: "gift-alerts",
        label: "Custom gift alerts → video/SFX/GIF overlays",
        status: "PARTIAL",
        note: "Cinema MP4 layer per gift SKU (Mad Scientist + lions + hero clips) + SFX map; no custom host-uploaded GIF library",
      },
      {
        id: "granular-tts",
        label: "Granular TTS (gift/chat triggers; skip/mute/ban words)",
        status: "PARTIAL",
        note: "Per-trigger toggles, ban words, skip; browser speechSynthesis only",
      },
      {
        id: "feed-widgets",
        label: "Interactive widgets (followers, goals, last gifter, leaderboards)",
        status: "PARTIAL",
        note: "Goals, gifters, chat, timer, jukebox on clean feed; followers widget not live",
      },
      {
        id: "chatbot-commands",
        label: "Chatbot & auto-responses / !commands",
        status: "MISSING",
        note: "Needs live-service command router",
      },
      {
        id: "webhooks",
        label: "Webhooks for physical/game actions",
        status: "MISSING",
        note: "Deck companion is local BroadcastChannel — not outbound webhooks",
      },
      {
        id: "alert-queue",
        label: "Alert queue (pause/replay/cancel)",
        status: "PARTIAL",
        note: "In-booth queue with pause / skip / replay last / clear",
      },
    ],
  },
  {
    id: "broadcast",
    title: "Broadcast & mods",
    blurb: "Live Studio DNA — chat, guests, metadata, health",
    items: [
      {
        id: "unified-chat",
        label: "Unified chat (VIP/sub/gifter highlights)",
        status: "PARTIAL",
        note: "Blyp watch chat + TikTok LIVE read path (comments/gifts) in the rail; no VIP/sub highlight tiers yet",
      },
      {
        id: "one-click-mod",
        label: "One-click mod (ban/timeout/pin)",
        status: "BLOCKED",
        note: "Needs live-service moderation APIs wired to web host",
      },
      {
        id: "metadata-hub",
        label: "Stream metadata hub (title, category, tags, cover)",
        status: "PARTIAL",
        note: "Title pre-flight; category/tags/cover not in booth",
      },
      {
        id: "platform-mechanics",
        label: "Native platform mechanics (polls, PK battle, multi-guest queue)",
        status: "PARTIAL",
        note: "Guest queue + Grid9/Nuke; polls/PK not in web studio",
      },
      {
        id: "connection-health",
        label: "Connection health (FPS, bitrate, dropped frames, ingest)",
        status: "PARTIAL",
        note: "Local FPS + target bitrate + publish state; no IVS dropped-frame telemetry yet",
      },
      {
        id: "vod-recording",
        label: "Automated VOD recording (cloud/local)",
        status: "MISSING",
        note: "Not claimed — no fake record controls",
      },
    ],
  },
  {
    id: "audio",
    title: "Audio mix",
    blurb: "Multi-bus mixer, monitoring, ducking",
    items: [
      {
        id: "multitrack-mixer",
        label: "Multi-track mixer (mic, desktop/game, alerts)",
        status: "PARTIAL",
        note: "Mic / music / alerts faders; no separate desktop/game capture bus",
      },
      {
        id: "noise-gate",
        label: "Noise suppression & gating",
        status: "MISSING",
        note: "Browser AEC only if device provides it — no studio gate UI",
      },
      {
        id: "ducking",
        label: "Audio ducking (voice / high-tier alerts)",
        status: "MISSING",
        note: "Not implemented",
      },
      {
        id: "output-monitor",
        label: "Independent output monitoring (alerts in cans)",
        status: "PARTIAL",
        note: "Toggle hear alerts locally vs publish-only; not a full monitor mix bus",
      },
    ],
  },
];

export function matrixStatusCounts(
  pillars: StudioMatrixPillar[] = STUDIO_FEATURE_MATRIX,
): Record<StudioFeatureStatus, number> {
  const counts: Record<StudioFeatureStatus, number> = {
    DONE: 0,
    PARTIAL: 0,
    MISSING: 0,
    BLOCKED: 0,
  };
  for (const p of pillars) {
    for (const item of p.items) counts[item.status] += 1;
  }
  return counts;
}
