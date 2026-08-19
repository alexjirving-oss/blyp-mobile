import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import { buildMainFfmpegArgs, buildOutboundCopyArgs, planNeedsPortraitOutput } from './ffmpegPipeline';

export type JobDestination = {
  destinationId: string;
  platform: string;
  profile: string;
  publishUrl: string;
  relayPath: string;
};

export type JobPayload = {
  sessionId: string;
  region: string;
  hlsUrl: string;
  destinations: JobDestination[];
};

type OutboundHandle = {
  relayPath: string;
  proc: ChildProcess;
};

type SessionJob = {
  sessionId: string;
  main: ChildProcess;
  outbounds: Map<string, OutboundHandle>;
};

const RTMP_BASE = 'rtmp://127.0.0.1:1935';
const RTSP_BASE = 'rtsp://127.0.0.1:8554';

export class RelayJobRunner {
  private mediamtx: ChildProcess | null = null;
  private jobs = new Map<string, SessionJob>();

  async ensureMediaMtx(): Promise<void> {
    if (this.mediamtx) return;
    const configPath = path.join(__dirname, '..', 'mediamtx.yml');
    this.mediamtx = spawn('mediamtx', [configPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.mediamtx.stdout?.on('data', (buf) => {
      process.stdout.write(`[mediamtx] ${buf}`);
    });
    this.mediamtx.stderr?.on('data', (buf) => {
      process.stderr.write(`[mediamtx] ${buf}`);
    });
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  private relayReadUrl(profile: string): string {
    if (profile === 'portrait_crop') {
      return `${RTSP_BASE}/portrait-internal`;
    }
    return `${RTSP_BASE}/landscape-internal`;
  }

  private async waitForRelayReady(pathName: string, timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:9997/v3/paths/get/${encodeURIComponent(pathName)}`);
        if (res.ok) {
          const data = (await res.json()) as { ready?: boolean; bytesReceived?: number };
          if (data.ready || (data.bytesReceived ?? 0) > 0) return;
        }
      } catch {
        /* mediamtx still booting */
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`RELAY_NOT_READY:${pathName}`);
  }

  private spawnFfmpeg(args: string[], label: string): ChildProcess {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stdout?.on('data', (buf) => process.stdout.write(`[${label}] ${buf}`));
    proc.stderr?.on('data', (buf) => process.stderr.write(`[${label}] ${buf}`));
    proc.on('exit', (code, signal) => {
      console.warn(`[${label}] exited code=${code} signal=${signal}`);
    });
    return proc;
  }

  async startJob(payload: JobPayload): Promise<void> {
    await this.ensureMediaMtx();
    await this.stopJob(payload.sessionId);

    const needsPortrait = planNeedsPortraitOutput(payload.destinations.map((d) => d.platform));
    const mainArgs = buildMainFfmpegArgs({
      hlsUrl: payload.hlsUrl,
      landscapeRelayUrl: `${RTMP_BASE}/landscape-internal`,
      portraitRelayUrl: needsPortrait ? `${RTMP_BASE}/portrait-internal` : undefined,
    });

    const main = this.spawnFfmpeg(mainArgs, `main:${payload.sessionId}`);
    const outbounds = new Map<string, OutboundHandle>();

    const relayPaths: string[] = ['landscape-internal'];
    if (needsPortrait) relayPaths.push('portrait-internal');
    for (const pathName of relayPaths) {
      await this.waitForRelayReady(pathName);
    }

    for (const dest of payload.destinations) {
      const readUrl = this.relayReadUrl(dest.profile);
      const args = buildOutboundCopyArgs({
        relayReadUrl: readUrl,
        publishUrl: dest.publishUrl,
        profile: dest.profile,
      });
      const proc = this.spawnFfmpeg(args, `out:${dest.relayPath}`);
      outbounds.set(dest.relayPath, { relayPath: dest.relayPath, proc });
    }

    this.jobs.set(payload.sessionId, { sessionId: payload.sessionId, main, outbounds });
  }

  async swapRelayTarget(input: {
    sessionId: string;
    relayPath: string;
    publishUrl: string;
    profile: string;
  }): Promise<void> {
    const job = this.jobs.get(input.sessionId);
    if (!job) throw new Error('SESSION_JOB_NOT_FOUND');

    const existing = job.outbounds.get(input.relayPath);
    if (existing) {
      existing.proc.kill('SIGTERM');
      job.outbounds.delete(input.relayPath);
    }

    const args = buildOutboundCopyArgs({
      relayReadUrl: this.relayReadUrl(input.profile),
      publishUrl: input.publishUrl,
      profile: input.profile,
    });
    const proc = this.spawnFfmpeg(args, `out:${input.relayPath}:swapped`);
    job.outbounds.set(input.relayPath, { relayPath: input.relayPath, proc });
  }

  async stopJob(sessionId: string): Promise<void> {
    const job = this.jobs.get(sessionId);
    if (!job) return;
    for (const outbound of job.outbounds.values()) {
      outbound.proc.kill('SIGTERM');
    }
    job.main.kill('SIGTERM');
    this.jobs.delete(sessionId);
  }

  activeSessionId(): string | null {
    if (this.jobs.size === 0) return null;
    return [...this.jobs.keys()][0];
  }

  async shutdown(): Promise<void> {
    for (const sessionId of [...this.jobs.keys()]) {
      await this.stopJob(sessionId);
    }
    if (this.mediamtx) {
      this.mediamtx.kill('SIGTERM');
      this.mediamtx = null;
    }
  }
}
