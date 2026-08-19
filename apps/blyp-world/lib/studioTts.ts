/**
 * Browser speechSynthesis for LIVE Studio gift / join / chat alerts.
 * Toggleable; soft-fails when SpeechSynthesis is unavailable.
 */

const TTS_PREFS_KEY = "blyp.liveStudio.tts.v1";

export type StudioTtsPrefs = {
  enabled: boolean;
  rate: number;
  voiceURI: string;
  /** Per-trigger gates (when master enabled) */
  speakGifts: boolean;
  speakChat: boolean;
  speakJoins: boolean;
  /** Comma/newline separated banned substrings (case-insensitive) */
  banWords: string;
};

const DEFAULT_PREFS: StudioTtsPrefs = {
  enabled: false,
  rate: 1,
  voiceURI: "",
  speakGifts: true,
  speakChat: true,
  speakJoins: true,
  banWords: "",
};

export function loadTtsPrefs(): StudioTtsPrefs {
  if (typeof window === "undefined") return { ...DEFAULT_PREFS };
  try {
    const raw = window.localStorage.getItem(TTS_PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<StudioTtsPrefs>;
    return {
      enabled: !!parsed.enabled,
      rate: Math.min(2, Math.max(0.5, Number(parsed.rate) || 1)),
      voiceURI: typeof parsed.voiceURI === "string" ? parsed.voiceURI : "",
      speakGifts: parsed.speakGifts !== false,
      speakChat: parsed.speakChat !== false,
      speakJoins: parsed.speakJoins !== false,
      banWords: typeof parsed.banWords === "string" ? parsed.banWords : "",
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function saveTtsPrefs(prefs: StudioTtsPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TTS_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

export function listTtsVoices(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !window.speechSynthesis) return [];
  return window.speechSynthesis.getVoices();
}

export function skipStudioTts(): void {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* soft-fail */
  }
}

function banList(prefs: StudioTtsPrefs): string[] {
  return prefs.banWords
    .split(/[\n,]+/)
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);
}

export function scrubTtsText(text: string, prefs: StudioTtsPrefs): string {
  let cleaned = text.replace(/\s+/g, " ").trim().slice(0, 180);
  for (const word of banList(prefs)) {
    if (!word) continue;
    const re = new RegExp(
      word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "gi",
    );
    cleaned = cleaned.replace(re, "…");
  }
  return cleaned.trim();
}

export type StudioTtsTrigger = "gift" | "chat" | "join" | "manual";

export function speakStudioAlert(
  text: string,
  prefs: StudioTtsPrefs = loadTtsPrefs(),
  trigger: StudioTtsTrigger = "manual",
): void {
  if (!prefs.enabled) return;
  if (trigger === "gift" && !prefs.speakGifts) return;
  if (trigger === "chat" && !prefs.speakChat) return;
  if (trigger === "join" && !prefs.speakJoins) return;
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  const cleaned = scrubTtsText(text, prefs);
  if (!cleaned || cleaned === "…") return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(cleaned);
    u.rate = prefs.rate;
    u.pitch = 1;
    u.volume = 1;
    const voices = window.speechSynthesis.getVoices();
    const match = prefs.voiceURI
      ? voices.find((v) => v.voiceURI === prefs.voiceURI)
      : voices.find((v) => /en(-|_|$)/i.test(v.lang)) || voices[0];
    if (match) u.voice = match;
    window.speechSynthesis.speak(u);
  } catch {
    /* soft-fail */
  }
}
