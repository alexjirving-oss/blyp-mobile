import { execFile, execFileSync } from "node:child_process";

import fs from "node:fs";

import os from "node:os";

import path from "node:path";

import { promisify } from "node:util";

import {

  readStatus,

  setCredentials,

  setError,

  setLiveStudioInstalled,

  setPhase,

  setScanDiagnostics,

} from "./state.js";

import type { ScanDiagnostics } from "./types.js";



const execFileAsync = promisify(execFile);



const RTMP_URL_RE =

  /rtmps?:\/\/[a-zA-Z0-9._-]+(?::\d+)?(?:\/[a-zA-Z0-9._~:/?#[\]@!$&'()*+,;=-]*)?/i;



const STREAM_KEY_JSON_RE =

  /"(?:stream[_-]?key|streamKey|publish[_-]?key|publishKey|publish[_-]?code|publishCode|stream[_-]?code|streamCode|push[_-]?stream[_-]?key|pushStreamKey)"\s*:\s*"([^"]{8,512})"/i;



const RTMP_JSON_RE =

  /"(?:rtmp[_-]?url|rtmpUrl|server[_-]?url|serverUrl|push[_-]?url|pushUrl|ingest[_-]?url|ingestUrl|stream[_-]?url|streamUrl|push[_-]?stream[_-]?url|pushStreamUrl|rtmp[_-]?push[_-]?url|rtmpPushUrl)"\s*:\s*"(rtmps?:\/\/[^"]+)"/i;



const HANDLE_JSON_RE =

  /"(?:unique[_-]?id|uniqueId|handle|username|nickName|display[_-]?id|displayId)"\s*:\s*"(@?[a-zA-Z0-9._]{2,32})"/i;



const STREAM_KEY_LOOSE_RE =

  /(?:stream[_ -]?key|publish[_ -]?key|streamKey|publishKey)[^A-Za-z0-9+/=_-]{0,24}([A-Za-z0-9+/=_-]{8,512})/i;



const EXE_NAMES = [

  "TikTok LIVE Studio.exe",

  "tiktok live studio.exe",

  "TikTokLiveStudio.exe",

];



let waitingRescanTimer: ReturnType<typeof setInterval> | null = null;

let fileWatchers: fs.FSWatcher[] = [];

let lastScanDiagnostics: ScanDiagnostics = {

  rootsChecked: 0,

  filesScanned: 0,

  roots: [],

};



type ParsedCredentials = {

  rtmpUrl: string;

  streamKey: string;

  handle?: string;

  filePath: string;

};



/** All known TikTok Live Studio 6.x Windows data roots (Roaming is primary). */

export function tikTokLiveStudioCandidateRoots(): string[] {

  const local = process.env.LOCALAPPDATA || "";

  const roaming = process.env.APPDATA || "";

  const home = os.homedir();

  const programFiles = [

    process.env["ProgramFiles"],

    process.env["ProgramFiles(x86)"],

  ].filter(Boolean) as string[];



  const candidates = [

    path.join(roaming, "TikTok LIVE Studio"),

    path.join(local, "TikTok LIVE Studio"),

    path.join(local, "tiktok live studio-updater"),

    path.join(local, "TikTokLiveStudio"),

    path.join(local, "tiktok-live-studio"),

    path.join(local, "Programs", "TikTok LIVE Studio"),

    path.join(roaming, "TikTokLiveStudio"),

    path.join(roaming, "tiktok-live-studio"),

    path.join(home, "AppData", "Roaming", "TikTok LIVE Studio"),

    path.join(home, "AppData", "Local", "TikTok LIVE Studio"),

    path.join(home, "AppData", "Local", "tiktok live studio-updater"),

    path.join(home, "Library", "Application Support", "TikTok LIVE Studio"),

    path.join(home, "Library", "Application Support", "tiktok-live-studio"),

  ];



  for (const pf of programFiles) {

    candidates.push(path.join(pf, "TikTok LIVE Studio"));

  }



  const installExe = findTikTokLiveStudioExe();

  if (installExe) {

    candidates.push(path.dirname(installExe));

  }



  return [...new Set(candidates.filter(Boolean))];

}



function existingCandidateRoots(): string[] {

  return tikTokLiveStudioCandidateRoots().filter((p) => {

    try {

      return fs.existsSync(p);

    } catch {

      return false;

    }

  });

}



function readRegistryInstallLocation(): string | null {

  if (process.platform !== "win32") return null;

  const keys = [

    "HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\tiktoklivestudio",

    "HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\tiktoklivestudio",

    "HKCU\\Software\\TikTok LIVE Studio",

  ];

  for (const key of keys) {

    try {

      const { stdout } = execFileSyncSafe(

        "reg",

        ["query", key, "/v", "InstallLocation"],

      );

      const match = stdout.match(/InstallLocation\s+REG_\w+\s+(.+)/i);

      if (match?.[1]?.trim()) return match[1].trim();

    } catch {

      /* key missing */

    }

    try {

      const { stdout } = execFileSyncSafe("reg", ["query", key]);

      const match = stdout.match(/InstallPath\s+REG_\w+\s+(.+)/i);

      if (match?.[1]?.trim()) return match[1].trim();

    } catch {

      /* key missing */

    }

  }

  return null;

}



function execFileSyncSafe(
  cmd: string,
  args: string[],
): { stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(cmd, args, { encoding: "utf8", windowsHide: true });
    return { stdout: String(stdout), stderr: "" };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string };
    return { stdout: err.stdout || "", stderr: err.stderr || "" };
  }
}



/** Locate TikTok Live Studio executable on this PC. */

export function findTikTokLiveStudioExe(): string | null {

  const checked = new Set<string>();



  const tryPath = (candidate: string): string | null => {

    const normalized = path.normalize(candidate);

    if (checked.has(normalized)) return null;

    checked.add(normalized);

    try {

      if (fs.existsSync(normalized) && fs.statSync(normalized).isFile()) {

        return normalized;

      }

    } catch {

      /* missing */

    }

    return null;

  };



  const regDir = readRegistryInstallLocation();

  if (regDir) {

    for (const name of EXE_NAMES) {

      const hit = tryPath(path.join(regDir, name));

      if (hit) return hit;

    }

    try {

      const versions = fs.readdirSync(regDir, { withFileTypes: true });

      for (const entry of versions) {

        if (!entry.isDirectory()) continue;

        for (const name of EXE_NAMES) {

          const hit = tryPath(path.join(regDir, entry.name, name));

          if (hit) return hit;

        }

      }

    } catch {

      /* unreadable */

    }

  }



  const local = process.env.LOCALAPPDATA || "";

  const programFiles = [

    process.env["ProgramFiles"],

    process.env["ProgramFiles(x86)"],

  ].filter(Boolean) as string[];



  const searchDirs = [

    ...programFiles.map((pf) => path.join(pf, "TikTok LIVE Studio")),

    path.join(local, "Programs", "TikTok LIVE Studio"),

  ];



  for (const dir of searchDirs) {

    try {

      if (!fs.existsSync(dir)) continue;

      for (const name of EXE_NAMES) {

        const hit = tryPath(path.join(dir, name));

        if (hit) return hit;

      }

      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {

        if (!entry.isDirectory()) continue;

        for (const name of EXE_NAMES) {

          const hit = tryPath(path.join(dir, entry.name, name));

          if (hit) return hit;

        }

      }

    } catch {

      /* unreadable */

    }

  }



  return null;

}



export function isTikTokLiveStudioInstalled(): boolean {

  return Boolean(findTikTokLiveStudioExe() || existingCandidateRoots().length > 0);

}



function normalizeHandle(raw: string | undefined): string | undefined {

  const v = String(raw || "")

    .trim()

    .replace(/^@/, "")

    .split(/[/?#]/)[0];

  return v || undefined;

}



function parseCredentialsFromText(text: string, filePath: string): ParsedCredentials | null {

  const rtmpMatch =

    text.match(RTMP_JSON_RE) ||

    text.match(/"(?:rtmp|server|push|ingest|stream)[^"]*"\s*:\s*"(rtmps?:\/\/[^"]+)"/i);

  const keyMatch =

    text.match(STREAM_KEY_JSON_RE) ||

    text.match(/"(?:key|stream|publish)[^"]*"\s*:\s*"([A-Za-z0-9+/=_-]{8,512})"/i);

  const handleMatch = text.match(HANDLE_JSON_RE);



  let rtmpUrl = rtmpMatch?.[1]?.trim().replace(/\/+$/, "") || "";

  let streamKey = keyMatch?.[1]?.trim() || "";



  if (!rtmpUrl) {

    const inline = text.match(RTMP_URL_RE);

    if (inline) rtmpUrl = inline[0].trim().replace(/\/+$/, "");

  }



  if (!streamKey) {

    const looseKey = text.match(STREAM_KEY_LOOSE_RE);

    if (looseKey) streamKey = looseKey[1].trim();

  }



  if (!streamKey && rtmpUrl) {

    const afterUrl = text.slice(text.indexOf(rtmpUrl) + rtmpUrl.length, text.indexOf(rtmpUrl) + rtmpUrl.length + 600);

    const neighborKey = afterUrl.match(/([A-Za-z0-9+/=_-]{16,512})/);

    if (neighborKey && !neighborKey[1].includes("rtmp")) {

      streamKey = neighborKey[1].trim();

    }

  }



  if (!rtmpUrl || !streamKey) return null;

  if (!RTMP_URL_RE.test(rtmpUrl)) return null;

  if (streamKey.includes("rtmp://") || streamKey.includes("rtmps://")) return null;



  return {

    rtmpUrl,

    streamKey,

    handle: normalizeHandle(handleMatch?.[1]),

    filePath,

  };

}



function shouldSkipDir(name: string): boolean {

  return /^(Code Cache|GPUCache|DawnCache|DawnGraphiteCache|DawnWebGPUCache|ShaderCache|blob_storage|Service Worker|Crashpad|VideoDecodeStats|WidevineCdm|gecko_cache|Cache|parfait|overlay|logs|watch_dog|AudioFIlters|Network|Shared Dictionary|Session Storage|Local Storage)$/i.test(

    name,

  );

}



const SCANNABLE_EXT =

  /\.(json|txt|cfg|ini|log|db|sqlite|sqlite3|dat|conf|ldb|sst|manifest|localstorage)$/i;



function walkFiles(root: string, depth = 0, maxDepth = 6): string[] {

  if (depth > maxDepth) return [];

  let entries: fs.Dirent[];

  try {

    entries = fs.readdirSync(root, { withFileTypes: true });

  } catch {

    return [];

  }

  const out: string[] = [];

  for (const entry of entries) {

    const full = path.join(root, entry.name);

    if (entry.isDirectory()) {

      if (shouldSkipDir(entry.name)) continue;

      out.push(...walkFiles(full, depth + 1, maxDepth));

      continue;

    }

    if (!SCANNABLE_EXT.test(entry.name) && !/^(Preferences|Local State|CURRENT|LOG)$/i.test(entry.name)) {

      continue;

    }

    try {

      const stat = fs.statSync(full);

      if (stat.size > 5_000_000) continue;

    } catch {

      continue;

    }

    out.push(full);

  }

  return out;

}



function readFileAsText(filePath: string): string {

  try {

    return fs.readFileSync(filePath, "utf8");

  } catch {

    const buf = fs.readFileSync(filePath);

    return buf.toString("latin1");

  }

}



function priorityScore(filePath: string): number {

  const base = path.basename(filePath).toLowerCase();

  const full = filePath.toLowerCase();

  if (/preferences|local state|stream|rtmp|live|session|config|settings/.test(base)) return 0;

  if (/leveldb|indexeddb|local storage|network/.test(full)) return 1;

  if (/\.db$|\.sqlite/.test(base)) return 2;

  if (/\.log$/.test(base)) return 3;

  return 4;

}



function priorityCredentialFiles(root: string): string[] {

  const out: string[] = [];

  const pushIf = (p: string) => {

    try {

      if (fs.existsSync(p) && fs.statSync(p).isFile()) out.push(p);

    } catch {

      /* missing */

    }

  };

  for (const name of ["data.db", "Preferences", "Local State", "log_sdk_v2.db"]) {

    pushIf(path.join(root, name));

  }

  const ttStore = path.join(root, "TTStore");

  for (const name of ["services.json", "localStore.json", "login.json"]) {

    pushIf(path.join(ttStore, name));

  }

  return out;

}



function deepFindCredentials(value: unknown, filePath: string, depth = 0): ParsedCredentials | null {

  if (depth > 12 || value == null) return null;

  if (typeof value === "string") {

    return parseCredentialsFromText(value, filePath);

  }

  if (Array.isArray(value)) {

    for (const item of value) {

      const hit = deepFindCredentials(item, filePath, depth + 1);

      if (hit) return hit;

    }

    return null;

  }

  if (typeof value === "object") {

    const obj = value as Record<string, unknown>;

    let rtmpUrl = "";

    let streamKey = "";

    let handle: string | undefined;

    for (const [k, v] of Object.entries(obj)) {

      const key = k.toLowerCase();

      if (typeof v === "string") {

        if (/rtmp|push.*url|server.*url|ingest.*url|stream.*url/.test(key) && RTMP_URL_RE.test(v)) {

          rtmpUrl = v.trim().replace(/\/+$/, "");

        } else if (/stream.*key|publish.*key|push.*key/.test(key) && v.length >= 8 && v.length <= 512) {

          streamKey = v.trim();

        } else if (/unique[_-]?id|handle|username|display[_-]?id|nick[_-]?name/.test(key)) {

          handle = normalizeHandle(v);

        }

      }

    }

    if (rtmpUrl && streamKey) {

      return { rtmpUrl, streamKey, handle, filePath };

    }

    for (const v of Object.values(obj)) {

      const hit = deepFindCredentials(v, filePath, depth + 1);

      if (hit) return hit;

    }

  }

  return null;

}



function parseStructuredCredentialFile(filePath: string): ParsedCredentials | null {

  if (!/\.json$/i.test(filePath)) return null;

  try {

    const data = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;

    return deepFindCredentials(data, filePath);

  } catch {

    return null;

  }

}



export function scanLocalTikTokCredentials(): ParsedCredentials | null {

  const roots = existingCandidateRoots();

  const files: string[] = [];



  for (const root of roots) {

    files.push(...priorityCredentialFiles(root));

  }



  const walked: string[] = [];

  for (const root of roots) {

    walked.push(...walkFiles(root, 0, 4));

  }



  const uniqueFiles = [...new Set([...files, ...walked])];

  uniqueFiles.sort((a, b) => priorityScore(a) - priorityScore(b));



  lastScanDiagnostics = {

    rootsChecked: roots.length,

    filesScanned: uniqueFiles.length,

    roots: roots.map((r) => redactPathForLog(r)),

    installedExe: findTikTokLiveStudioExe() || undefined,

  };

  setScanDiagnostics(lastScanDiagnostics);



  for (const filePath of uniqueFiles) {

    const structured = parseStructuredCredentialFile(filePath);

    if (structured) return structured;



    let text = "";

    try {

      text = readFileAsText(filePath);

    } catch {

      continue;

    }

    const parsed = parseCredentialsFromText(text, filePath);

    if (parsed) return parsed;



    if (/\.(db|sqlite|sqlite3|ldb|sst)$/i.test(filePath) || /data\.db|preferences|local state/i.test(path.basename(filePath))) {

      const rtmpIdx = text.search(RTMP_URL_RE);

      if (rtmpIdx >= 0) {

        const slice = text.slice(Math.max(0, rtmpIdx - 200), rtmpIdx + 1200);

        const binaryParsed = parseCredentialsFromText(slice, filePath);

        if (binaryParsed) return binaryParsed;

      }

    }

  }



  return null;

}



function redactPathForLog(p: string): string {

  const home = os.homedir();

  if (p.startsWith(home)) return p.replace(home, "~");

  return p;

}



export function getLastScanDiagnostics(): ScanDiagnostics {

  return lastScanDiagnostics;

}



export function stopWaitingRescan(): void {

  if (waitingRescanTimer) {

    clearInterval(waitingRescanTimer);

    waitingRescanTimer = null;

  }

  for (const watcher of fileWatchers) {

    try {

      watcher.close();

    } catch {

      /* ignore */

    }

  }

  fileWatchers = [];

}



function applyCachedCredentials(cached: ParsedCredentials, context: string): void {

  stopWaitingRescan();

  setCredentials({

    rtmpUrl: cached.rtmpUrl,

    streamKey: cached.streamKey,

    handle: cached.handle,

    source: "local_cache",

  });

  logInfo(`${context} (${redactPathForLog(cached.filePath)})`);

}



function tryRescanDuringWait(context: string): boolean {

  const cached = scanLocalTikTokCredentials();

  if (!cached) return false;

  applyCachedCredentials(cached, context);

  return true;

}



function startWaitingRescan(): void {

  stopWaitingRescan();



  const roots = existingCandidateRoots();

  const watchTargets = new Set<string>();

  for (const root of roots) {

    watchTargets.add(root);

    watchTargets.add(path.join(root, "TTStore"));

  }

  for (const target of watchTargets) {

    try {

      if (!fs.existsSync(target)) continue;

      const watcher = fs.watch(target, { recursive: process.platform === "win32" }, () => {

        const current = readStatus();

        if (current.connected || current.phase !== "watching") return;

        tryRescanDuringWait("Found RTMP credentials via file watcher");

      });

      fileWatchers.push(watcher);

    } catch {

      /* watch unsupported for this root */

    }

  }



  waitingRescanTimer = setInterval(() => {

    const current = readStatus();

    if (current.connected || current.phase !== "watching") {

      stopWaitingRescan();

      return;

    }

    tryRescanDuringWait("Found RTMP credentials during wait");

  }, 2_000);

}



export async function launchTikTokLiveStudio(): Promise<boolean> {

  const exe = findTikTokLiveStudioExe();

  if (!exe) return false;



  logInfo(`Launching TikTok Live Studio (${redactPathForLog(exe)})`);

  if (process.platform === "win32") {

    await execFileAsync("cmd", ["/c", "start", "", exe], { windowsHide: true });

    return true;

  }

  if (process.platform === "darwin") {

    await execFileAsync("open", [exe]);

    return true;

  }

  await execFileAsync(exe, []);
  return true;

}



export async function beginConnectFlow(): Promise<{ connected: boolean }> {

  stopWaitingRescan();

  setPhase("scanning", "Scanning TikTok Live Studio on this PC…");



  const installed = isTikTokLiveStudioInstalled();

  setLiveStudioInstalled(installed);



  const cached = scanLocalTikTokCredentials();

  if (cached) {

    applyCachedCredentials(cached, "Found RTMP credentials in local TikTok Live Studio cache");

    return { connected: true };

  }



  if (!installed) {

    const diag = getLastScanDiagnostics();

    setError(

      "TikTok Live Studio is not installed on this PC — install it from TikTok, sign in, then click Connect TikTok again.",

    );

    logInfo(

      `Scan complete: installed=false roots=${diag.rootsChecked} files=${diag.filesScanned} (no credential files found)`,

    );

    return { connected: false };

  }



  setPhase(

    "launching_app",

    "Launching TikTok Live Studio — open Go LIVE → Stream settings so credentials are written locally",

  );



  const launched = await launchTikTokLiveStudio();

  if (!launched) {

    setError(

      "TikTok Live Studio data found but the app could not be launched — open Live Studio manually, go to Go LIVE → Stream settings, then click Connect TikTok again.",

    );

    return { connected: false };

  }



  setPhase(

    "watching",

    "Waiting for TikTok Live Studio to write Server URL + Stream key (Go LIVE → Stream settings in Live Studio)",

  );

  startWaitingRescan();



  return { connected: false };

}



export function applyManualCredentials(input: {

  rtmpUrl: string;

  streamKey: string;

  handle?: string;

}): { ok: true } | { ok: false; message: string } {

  const rtmpUrl = String(input.rtmpUrl || "").trim().replace(/\/+$/, "");

  const streamKey = String(input.streamKey || "").trim();

  if (!rtmpUrl || !RTMP_URL_RE.test(rtmpUrl)) {

    return { ok: false, message: "Server URL must start with rtmp:// or rtmps://" };

  }

  if (!streamKey || streamKey.length < 8 || streamKey.length > 512) {

    return { ok: false, message: "Stream key must be 8–512 characters" };

  }

  stopWaitingRescan();

  setCredentials({

    rtmpUrl,

    streamKey,

    handle: normalizeHandle(input.handle),

    source: "manual_paste",

  });

  return { ok: true };

}



function logInfo(msg: string): void {

  const debug = process.env.BLYP_TIKTOK_COMPANION_DEBUG === "1";

  if (debug) {

    console.log(`[blyp-tiktok-companion] ${msg}`);

    return;

  }

  const safe = msg

    .replace(/stream[_-]?key[=:\s"']+[A-Za-z0-9+/=_-]{8,}/gi, "stream_key=[redacted]")

    .replace(/rtmps?:\/\/\S+/gi, "rtmp://[redacted]");

  console.log(`[blyp-tiktok-companion] ${safe}`);

}

