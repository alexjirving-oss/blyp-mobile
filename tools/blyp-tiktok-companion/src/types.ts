export type CompanionPhase =

  | "idle"

  | "scanning"

  | "launching_app"

  | "watching"

  | "connected"

  | "error";



export type CompanionStatus = {

  connected: boolean;

  phase: CompanionPhase;

  rtmpUrl?: string;

  streamKey?: string;

  handle?: string;

  error?: string;

  source?: "local_cache" | "manual_paste";

  message?: string;

  liveStudioInstalled?: boolean;

  scan?: ScanDiagnostics;

};



export type ScanDiagnostics = {

  rootsChecked: number;

  filesScanned: number;

  roots: string[];

  installedExe?: string;

};



export type HealthResponse = {

  ok: true;

  version: string;

  port: number;

  liveStudioInstalled: boolean;

  installedExe?: string;

};



export type CredentialsPayload = {

  rtmpUrl?: string;

  streamKey?: string;

  handle?: string;

};

