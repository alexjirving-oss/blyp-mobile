import type { CompanionPhase, CompanionStatus, ScanDiagnostics } from "./types.js";



let phase: CompanionPhase = "idle";

let connected = false;

let rtmpUrl = "";

let streamKey = "";

let handle = "";

let error = "";

let source: CompanionStatus["source"];

let message = "";

let liveStudioInstalled = false;

let scan: ScanDiagnostics | undefined;



export function readStatus(): CompanionStatus {

  const out: CompanionStatus = { connected, phase };

  if (rtmpUrl) out.rtmpUrl = rtmpUrl;

  if (streamKey) out.streamKey = streamKey;

  if (handle) out.handle = handle;

  if (error) out.error = error;

  if (source) out.source = source;

  if (message) out.message = message;

  if (liveStudioInstalled) out.liveStudioInstalled = liveStudioInstalled;

  if (scan) out.scan = scan;

  return out;

}



export function resetStatus(): void {

  phase = "idle";

  connected = false;

  rtmpUrl = "";

  streamKey = "";

  handle = "";

  error = "";

  source = undefined;

  message = "";

  liveStudioInstalled = false;

  scan = undefined;

}



export function setPhase(next: CompanionPhase, nextMessage?: string): void {

  phase = next;

  message = nextMessage || "";

}



export function setError(detail: string): void {

  phase = "error";

  error = detail;

  message = detail;

  connected = false;

}



export function setLiveStudioInstalled(installed: boolean): void {

  liveStudioInstalled = installed;

}



export function setScanDiagnostics(next: ScanDiagnostics): void {

  scan = next;

}



export function setCredentials(input: {

  rtmpUrl: string;

  streamKey: string;

  handle?: string;

  source: NonNullable<CompanionStatus["source"]>;

}): void {

  rtmpUrl = input.rtmpUrl;

  streamKey = input.streamKey;

  handle = input.handle || "";

  source = input.source;

  connected = true;

  phase = "connected";

  error = "";

  message = "Connected";

}

