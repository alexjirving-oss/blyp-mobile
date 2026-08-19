/**
 * Multistream destination labels for P-BLYP-BROADCAST-UI.
 * Pure helpers — no React, no live-service calls.
 */

export type StudioDestinationId =
  | "blyp"
  | "tiktok"
  | "youtube"
  | "twitch"
  | "facebook"
  | "kick";

export type StudioDestinationCard = {
  id: StudioDestinationId;
  label: string;
};

export type StudioGoLiveDestFlags = {
  tiktokReady: boolean;
  youtubeReady?: boolean;
  twitchReady?: boolean;
  facebookReady?: boolean;
  kickReady?: boolean;
};

/** Destinations included when GO LIVE is clicked. Blyp is always on. */
export function activeGoLiveDestinations(
  input: StudioGoLiveDestFlags,
): StudioDestinationCard[] {
  const out: StudioDestinationCard[] = [{ id: "blyp", label: "Blyp" }];
  if (input.tiktokReady) {
    out.push({ id: "tiktok", label: "TikTok" });
  }
  if (input.youtubeReady) {
    out.push({ id: "youtube", label: "YouTube" });
  }
  if (input.twitchReady) {
    out.push({ id: "twitch", label: "Twitch" });
  }
  if (input.facebookReady) {
    out.push({ id: "facebook", label: "Facebook" });
  }
  if (input.kickReady) {
    out.push({ id: "kick", label: "Kick" });
  }
  return out;
}

export function goingLiveToLabel(input: StudioGoLiveDestFlags): string {
  return activeGoLiveDestinations(input)
    .map((d) => d.label)
    .join(", ");
}

export function setupGoLiveSummary(input: StudioGoLiveDestFlags): string {
  return `Going live to: ${goingLiveToLabel(input)}`;
}

export function liveGoLiveSummary(
  input: StudioGoLiveDestFlags & {
    broadcastPhase: string | null;
    broadcastMessage: string | null;
  },
): string {
  const extra = Boolean(
    input.tiktokReady ||
      input.youtubeReady ||
      input.twitchReady ||
      input.facebookReady ||
      input.kickReady,
  );
  const base = goingLiveToLabel(input);
  if (input.broadcastPhase === "provisioning" || input.broadcastPhase === "starting") {
    return input.broadcastMessage || `Live on ${base} · connecting…`;
  }
  if (input.broadcastPhase === "live") {
    return `Live on: ${base.replaceAll(", ", " + ")}`;
  }
  if (input.broadcastPhase === "failed" && extra) {
    return `Live on Blyp · extra destination failed`;
  }
  return `Live on: ${base.replaceAll(", ", " + ")}`;
}

export type TikTokDockBadge = "needs-key" | "ready";

export function tiktokDockBadge(ready: boolean): TikTokDockBadge {
  return ready ? "ready" : "needs-key";
}

export type TikTokLiveStatus = "off" | "connecting" | "live" | "failed";

export function tiktokLiveStatus(input: {
  tiktokReady: boolean;
  phase: string | null;
}): TikTokLiveStatus {
  if (!input.tiktokReady) return "off";
  if (input.phase === "live") return "live";
  if (input.phase === "failed") return "failed";
  if (input.phase === "provisioning" || input.phase === "starting") {
    return "connecting";
  }
  return "off";
}

export function tiktokLiveStatusLabel(status: TikTokLiveStatus): string {
  switch (status) {
    case "live":
      return "LIVE";
    case "connecting":
      return "Connecting";
    case "failed":
      return "Failed";
    default:
      return "Off";
  }
}
