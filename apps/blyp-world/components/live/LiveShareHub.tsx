"use client";

import { useCallback, useState } from "react";
import {
  emailShareUrl,
  liveDiscordAnnounceBlurb,
  liveGuestInviteBlurb,
  liveLinkInBioLine,
  liveShareSheetText,
  liveSmsBlurb,
  liveTikTokDmBlurb,
  liveWhatsAppTelegramBlurb,
  qrImageUrl,
  smsShareUrl,
  telegramShareUrl,
  whatsAppShareUrl,
  type LiveShareContext,
} from "@/lib/liveShareCopy";

type Props = {
  title: string;
  watchUrl: string;
  hostName?: string;
  appDeepLink?: string;
  className?: string;
  onToast?: (msg: string) => void;
};

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function ChannelBtn({
  label,
  hint,
  onClick,
  primary,
  href,
}: {
  label: string;
  hint?: string;
  onClick?: () => void;
  primary?: boolean;
  href?: string;
}) {
  const className = primary
    ? "rounded-lg bg-[var(--blyp-teal)] px-3 py-2 text-xs font-bold text-[var(--blyp-ink)]"
    : "rounded-lg border border-[var(--blyp-line)] px-3 py-2 text-xs font-semibold text-[var(--blyp-fog)] hover:border-[var(--blyp-teal)]/50";
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
        title={hint}
      >
        {label}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={className} title={hint}>
      {label}
    </button>
  );
}

export function LiveShareHub({
  title,
  watchUrl,
  hostName,
  appDeepLink,
  className = "",
  onToast,
}: Props) {
  const [preview, setPreview] = useState<string | null>(null);
  const [previewLabel, setPreviewLabel] = useState("");
  const ctx: LiveShareContext = { title, watchUrl, hostName };

  const toast = useCallback(
    (msg: string) => {
      onToast?.(msg);
    },
    [onToast],
  );

  const copy = useCallback(
    async (label: string, text: string) => {
      const ok = await writeClipboard(text);
      setPreview(text);
      setPreviewLabel(label);
      toast(ok ? `${label} copied` : "Couldn’t copy — select the text below");
    },
    [toast],
  );

  const nativeShare = async () => {
    const text = liveShareSheetText(ctx);
    try {
      if (navigator.share) {
        await navigator.share({
          title: `${title} on Blyp LIVE`,
          text,
          url: watchUrl,
        });
        toast("Share sheet opened");
        return;
      }
    } catch {
      /* cancelled */
    }
    await copy("Watch link", text);
  };

  const waText = liveWhatsAppTelegramBlurb(ctx);
  const tikTok = liveTikTokDmBlurb(ctx);
  const discord = liveDiscordAnnounceBlurb(ctx);
  const guest = liveGuestInviteBlurb(ctx);
  const bio = liveLinkInBioLine(ctx);
  const sms = liveSmsBlurb(ctx);

  return (
    <div
      className={`rounded-xl border border-[var(--blyp-line)] bg-[var(--blyp-ink-elevated)] p-4 md:p-5 ${className}`}
    >
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-display text-lg font-bold tracking-tight">
            Share watch link
          </h2>
          <p className="mt-1 text-sm text-[var(--blyp-muted)]">
            Copy → paste into TikTok DM, Discord, WhatsApp, Telegram, SMS. Same
            operator workflow as Teams — Blyp can’t send TikTok messages for you.
          </p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_auto]">
        <div className="space-y-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--blyp-teal)]">
              One-tap copy
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <ChannelBtn
                primary
                label="Copy for TikTok DM"
                onClick={() => void copy("TikTok DM", tikTok)}
              />
              <ChannelBtn
                primary
                label="Copy for Discord"
                onClick={() => void copy("Discord", discord)}
              />
              <ChannelBtn
                label="WhatsApp / Telegram text"
                onClick={() => void copy("WhatsApp/Telegram", waText)}
              />
              <ChannelBtn
                label="Guest invite blurb"
                onClick={() => void copy("Guest invite", guest)}
              />
              <ChannelBtn
                label="Link-in-bio"
                onClick={() => void copy("Bio line", bio)}
              />
            </div>
          </div>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--blyp-gold)]">
              Open in…
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <ChannelBtn label="WhatsApp" href={whatsAppShareUrl(waText)} />
              <ChannelBtn
                label="Telegram"
                href={telegramShareUrl(waText, watchUrl)}
              />
              <ChannelBtn label="SMS" href={smsShareUrl(sms)} />
              <ChannelBtn
                label="Email"
                href={emailShareUrl(`LIVE on Blyp — ${title}`, waText)}
              />
              <ChannelBtn label="Share…" onClick={() => void nativeShare()} />
              <ChannelBtn
                label="Copy watch URL"
                onClick={() => void copy("Watch URL", watchUrl)}
              />
            </div>
          </div>

          <div className="rounded-lg border border-[var(--blyp-line)] bg-[var(--blyp-ink)]/50 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--blyp-teal)]">
              Public watch URL
            </p>
            <p className="mt-1.5 break-all font-mono text-xs text-[var(--blyp-fog)]">
              {watchUrl}
            </p>
            {appDeepLink ? (
              <p className="mt-1 break-all font-mono text-[10px] text-[var(--blyp-muted)]">
                App: {appDeepLink}
              </p>
            ) : null}
          </div>

          {preview ? (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--blyp-muted)]">
                Preview · {previewLabel}
              </p>
              <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--blyp-line)] bg-[var(--blyp-ink)] px-3 py-2.5 font-sans text-xs leading-relaxed text-[var(--blyp-fog)]">
                {preview}
              </pre>
            </div>
          ) : null}
        </div>

        <div className="flex flex-col items-center justify-start gap-2 rounded-lg border border-[var(--blyp-line)] bg-[var(--blyp-ink)]/40 px-4 py-4 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrImageUrl(watchUrl, 160)}
            alt="QR code for LIVE watch link"
            width={160}
            height={160}
            className="rounded-md bg-white p-1"
          />
          <p className="max-w-[10rem] text-[10px] leading-snug text-[var(--blyp-muted)]">
            Scan to open watch page — print for IRL or drop in Discord.
          </p>
        </div>
      </div>
    </div>
  );
}
