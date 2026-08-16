/** Copy templates agencies paste into TikTok / Discord / WhatsApp / SMS. */
export type TeamShareContext = {
  teamName: string;
  inviteUrl: string;
  leaderName?: string;
};
/** One-liner money truth for operators — all gift surfaces, not LIVE-only. */
export const AGENCY_CUT_ONE_LINER =
  "You earn 10% from Blyp’s half on every gift to your roster — LIVE, posts, messages, dating. Creators keep 100% of their half.";
export function tikTokDmBlurb(ctx: TeamShareContext): string {
  const who = ctx.leaderName ? ` — ${ctx.leaderName}` : "";
  return `hey — join my Blyp team${who} 🔥 better cut (gifts on LIVE + posts + DMs + dating), clear money. tap: ${ctx.inviteUrl}`;
}
export function discordAnnounceBlurb(ctx: TeamShareContext): string {
  return [
    `**${ctx.teamName} is recruiting on Blyp**`,
    ``,
    `50/50 gifts — you keep your half. Agency cut is 10% from Blyp’s side on ALL gifts (LIVE, posts, messages, dating).`,
    `Join: ${ctx.inviteUrl}`,
    ``,
    `Ping me after you join so I can accept you.`,
  ].join("\n");
}
export function whatsAppTelegramBlurb(ctx: TeamShareContext): string {
  return `Join ${ctx.teamName} on Blyp — clear 50/50. Agency cut on every gift surface (LIVE + posts + messages + dating).\n${ctx.inviteUrl}`;
}
export function linkInBioLine(ctx: TeamShareContext): string {
  return `Join ${ctx.teamName} on Blyp → ${ctx.inviteUrl}`;
}
export function welcomeAfterAccept(
  ctx: TeamShareContext,
  hostName?: string,
): string {
  const hi = hostName ? `Hey ${hostName}` : "Hey";
  return [
    `${hi} — welcome to ${ctx.teamName} on Blyp 🎉`,
    ``,
    `You’re in. Day 1:`,
    `1) Go LIVE or post — gifts work on LIVE, posts, messages & dating`,
    `2) You keep 100% of your 50% half`,
    `3) Ping me on Discord/WhatsApp if you need anything`,
    ``,
    `Team link: ${ctx.inviteUrl}`,
  ].join("\n");
}
export function nudgeInactiveBlurb(
  ctx: TeamShareContext,
  hostName?: string,
): string {
  const hi = hostName ? `hey ${hostName}` : "hey";
  return `${hi} — missed you on Blyp this week. free for a LIVE or a post? team’s ${ctx.teamName}. ${ctx.inviteUrl}`;
}
export function shareSheetText(ctx: TeamShareContext): string {
  return `Join ${ctx.teamName} on Blyp — clear 50/50, agency cut on all gifts (LIVE + posts + messages + dating)\n${ctx.inviteUrl}`;
}
export function qrImageUrl(inviteUrl: string, size = 180): string {
  const q = encodeURIComponent(inviteUrl);
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${q}`;
}
export function whatsAppShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
export function telegramShareUrl(text: string, url?: string): string {
  const params = new URLSearchParams({ text });
  if (url) params.set("url", url);
  return `https://t.me/share/url?${params.toString()}`;
}
export function smsShareUrl(text: string): string {
  return `sms:?body=${encodeURIComponent(text)}`;
}
export function emailShareUrl(subject: string, body: string): string {
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
