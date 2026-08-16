/** Copy templates hosts paste into TikTok / Discord / WhatsApp / SMS for LIVE. */
import {
  emailShareUrl,
  qrImageUrl,
  smsShareUrl,
  telegramShareUrl,
  whatsAppShareUrl,
} from "./teamShareCopy";

export type LiveShareContext = {
  title: string;
  watchUrl: string;
  hostName?: string;
  guestInviteHint?: string;
};

export function liveTikTokDmBlurb(ctx: LiveShareContext): string {
  const who = ctx.hostName ? ` — ${ctx.hostName}` : "";
  return `i’m LIVE on Blyp${who} 🔴 ${ctx.title}\nwatch: ${ctx.watchUrl}`;
}

export function liveDiscordAnnounceBlurb(ctx: LiveShareContext): string {
  return [
    `**🔴 LIVE on Blyp — ${ctx.title}**`,
    ``,
    `Watch / drop in: ${ctx.watchUrl}`,
    ctx.hostName ? `Host: ${ctx.hostName}` : "",
    ``,
    `Gifts work on LIVE (and posts / messages / dating).`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function liveWhatsAppTelegramBlurb(ctx: LiveShareContext): string {
  return `🔴 I’m LIVE on Blyp — ${ctx.title}\n${ctx.watchUrl}`;
}

export function liveSmsBlurb(ctx: LiveShareContext): string {
  return `LIVE on Blyp: ${ctx.title} ${ctx.watchUrl}`;
}

export function liveLinkInBioLine(ctx: LiveShareContext): string {
  return `Watch me LIVE on Blyp → ${ctx.watchUrl}`;
}

export function liveShareSheetText(ctx: LiveShareContext): string {
  return `Watch ${ctx.title} LIVE on Blyp\n${ctx.watchUrl}`;
}

export function liveGuestInviteBlurb(ctx: LiveShareContext): string {
  return [
    `come up as a guest on my Blyp LIVE 🎙`,
    ctx.title,
    `1) Open Blyp app`,
    `2) Open this watch link and tap Request to join`,
    ctx.watchUrl,
    ctx.guestInviteHint || "I’ll accept you from LIVE Studio / the app.",
  ].join("\n");
}

export {
  emailShareUrl,
  qrImageUrl,
  smsShareUrl,
  telegramShareUrl,
  whatsAppShareUrl,
};
