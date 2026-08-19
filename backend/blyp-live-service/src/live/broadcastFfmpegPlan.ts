/**
 * Pure FFmpeg argument builder for the fan-out worker engine proof.
 * Landscape: stream copy. Portrait (TikTok): center-crop 9:16 transcode to local relay.
 */

export type FfmpegRelayPlan = {
  hlsUrl: string;
  landscapeRelayUrl: string;
  portraitRelayUrl?: string;
};

export function buildMainFfmpegArgs(plan: FfmpegRelayPlan): string[] {
  const args = [
    '-hide_banner',
    '-loglevel',
    'warning',
    '-reconnect',
    '1',
    '-reconnect_streamed',
    '1',
    '-reconnect_delay_max',
    '5',
    '-i',
    plan.hlsUrl,
  ];

  args.push(
    '-map', '0:v:0',
    '-map', '0:a:0?',
    '-c:v', 'copy',
    '-c:a', 'copy',
    '-f', 'flv',
    plan.landscapeRelayUrl,
  );

  if (plan.portraitRelayUrl) {
    args.push(
      '-map', '0:v:0',
      '-map', '0:a:0?',
      '-vf', 'crop=ih*9/16:ih,scale=1080:1920',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-b:v', '2500k',
      '-maxrate', '2500k',
      '-bufsize', '5000k',
      '-g', '50',
      '-fps_mode', 'cfr',
      '-c:a', 'copy',
      '-f', 'flv',
      plan.portraitRelayUrl,
    );
  }

  return args;
}

/** Outbound pusher: relay → external RTMP with copy (no re-encode). */
export function buildOutboundCopyArgs(input: {
  relayReadUrl: string;
  publishUrl: string;
}): string[] {
  return [
    '-hide_banner',
    '-loglevel', 'warning',
    '-rtsp_transport', 'tcp',
    '-i', input.relayReadUrl,
    '-c:v', 'copy',
    '-c:a', 'copy',
    '-f', 'flv',
    input.publishUrl,
  ];
}

export function planNeedsPortraitOutput(platforms: string[]): boolean {
  return platforms.some((p) => p === 'tiktok');
}
