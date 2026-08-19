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

export function buildOutboundCopyArgs(input: {
  relayReadUrl: string;
  publishUrl: string;
  profile?: string;
}): string[] {
  const args = [
    '-hide_banner',
    '-loglevel', 'warning',
    '-rtsp_transport', 'tcp',
    '-fflags', '+genpts',
    '-avoid_negative_ts', 'make_zero',
    '-i', input.relayReadUrl,
  ];

  if (input.profile === 'portrait_crop') {
    args.push(
      '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
      '-c:a', 'copy',
    );
  } else {
    args.push('-c:v', 'copy', '-c:a', 'copy');
  }

  args.push('-max_muxing_queue_size', '1024', '-f', 'flv', input.publishUrl);
  return args;
}

export function planNeedsPortraitOutput(platforms: string[]): boolean {
  return platforms.some((p) => p === 'tiktok');
}
