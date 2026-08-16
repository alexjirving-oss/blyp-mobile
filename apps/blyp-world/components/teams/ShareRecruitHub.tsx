"use client";
import { useCallback, useState } from "react";
import {
  AGENCY_CUT_ONE_LINER,
  discordAnnounceBlurb,
  emailShareUrl,
  linkInBioLine,
  nudgeInactiveBlurb,
  qrImageUrl,
  shareSheetText,
  smsShareUrl,
  telegramShareUrl,
  tikTokDmBlurb,
  welcomeAfterAccept,
  whatsAppShareUrl,
  whatsAppTelegramBlurb,
  type TeamShareContext,
} from "@/lib/teamShareCopy";
type Props = {
  teamName: string;
  inviteUrl: string;
  leaderName?: string;
  deepLink?: string;
  /** Compact strip for marketing / apply — primary copy buttons only */
  compact?: boolean;
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
export function ShareRecruitHub({
  teamName,
  inviteUrl,
  leaderName,
  deepLink,
  compact = false,
  className = "",
  onToast,
}: Props) {
  const [preview, setPreview] = useState<string | null>(null);
  const [previewLabel, setPreviewLabel] = useState("");
  const ctx: TeamShareContext = { teamName, inviteUrl, leaderName };
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
    const text = shareSheetText(ctx);
    try {
      if (navigator.share) {
        await navigator.share({
          title: `${teamName} on Blyp`,
          text,
          url: inviteUrl,
        });
        toast("Share sheet opened");
        return;
      }
    } catch {
      /* cancelled or unavailable */
    }
    await copy("Invite", text);
  };
  const waText = whatsAppTelegramBlurb(ctx);
  const tikTok = tikTokDmBlurb(ctx);
  const discord = discordAnnounceBlurb(ctx);
  const bio = linkInBioLine(ctx);
  if (compact) {
    return (
      <div
        className={`rounded-xl border border-[var(--blyp-line)] bg-[var(--blyp-ink)]/40 p-4 ${className}`}
      >
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--blyp-teal)]">
          Share & recruit
        </p>
        <p className="mt-1 text-sm text-[var(--blyp-muted)]">
          Agencies live in TikTok DMs and Discord — copy → paste. No fake TikTok
          send button.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <ChannelBtn
            primary
            label="Copy for TikTok DM"
            hint="Paste into TikTok messages"
            onClick={() => void copy("TikTok DM", tikTok)}
          />
          <ChannelBtn
            primary
            label="Copy for Discord"
            onClick={() => void copy("Discord", discord)}
          />
          <ChannelBtn
            label="WhatsApp"
            href={whatsAppShareUrl(waText)}
          />
          <ChannelBtn
            label="Copy invite link"
            onClick={() => void copy("Invite link", inviteUrl)}
          />
        </div>
        {preview ? (
          <pre className="mt-3 max-h-28 overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--blyp-line)] bg-[var(--blyp-ink)] px-3 py-2 font-sans text-[11px] text-[var(--blyp-fog)]">
            {preview}
          </pre>
        ) : null}
      </div>
    );
  }
  return (
    <div
      id="share-recruit"
      className={`rounded-xl border border-[var(--blyp-line)] bg-[var(--blyp-ink-elevated)] p-4 md:p-5 ${className}`}
    >
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-display text-lg font-bold tracking-tight">
            Share & recruit
          </h2>
          <p className="mt-1 text-sm text-[var(--blyp-muted)]">
            Copy → paste into TikTok DM, Discord, WhatsApp, Telegram, SMS. Blyp
            can’t send TikTok messages (no API) — that’s the real workflow.
          </p>
          <p className="mt-2 text-xs font-medium text-[var(--blyp-fog)]/90">
            {AGENCY_CUT_ONE_LINER}
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
                hint="Copy → paste into TikTok DM"
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
                label="Link-in-bio line"
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
                href={telegramShareUrl(waText, inviteUrl)}
              />
              <ChannelBtn
                label="SMS"
                href={smsShareUrl(waText)}
              />
              <ChannelBtn
                label="Email invite"
                href={emailShareUrl(
                  `Join ${teamName} on Blyp`,
                  `${waText}\n\n(Paste this if the link doesn’t open.)`,
                )}
              />
              <ChannelBtn label="Share…" onClick={() => void nativeShare()} />
              <ChannelBtn
                label="Discord (copy)"
                hint="Discord has no clean web share URL — copy the announce blurb"
                onClick={() => void copy("Discord", discord)}
              />
            </div>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--blyp-muted)]">
              After they join
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <ChannelBtn
                label="Welcome message"
                onClick={() =>
                  void copy("Welcome", welcomeAfterAccept(ctx))
                }
              />
              <ChannelBtn
                label="Nudge inactive"
                onClick={() => void copy("Nudge", nudgeInactiveBlurb(ctx))}
              />
            </div>
          </div>
          <div className="rounded-lg border border-[var(--blyp-line)] bg-[var(--blyp-ink)]/50 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--blyp-teal)]">
              Invite URL
            </p>
            <p className="mt-1.5 break-all font-mono text-xs text-[var(--blyp-fog)]">
              {inviteUrl}
            </p>
            {deepLink ? (
              <p className="mt-1 break-all font-mono text-[10px] text-[var(--blyp-muted)]">
                App: {deepLink}
              </p>
            ) : null}
            <button
              type="button"
              onClick={() =>
                void copy(
                  "Invite",
                  deepLink
                    ? `Join ${teamName} on Blyp\n${inviteUrl}\n${deepLink}`
                    : inviteUrl,
                )
              }
              className="mt-2 text-xs font-semibold text-[var(--blyp-teal)]"
            >
              Copy invite URL →
            </button>
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
            src={qrImageUrl(inviteUrl, 160)}
            alt={`QR code for ${teamName} invite`}
            width={160}
            height={160}
            className="rounded-md bg-white p-1"
          />
          <p className="max-w-[10rem] text-[10px] leading-snug text-[var(--blyp-muted)]">
            Scan to open invite — print for events or drop in Discord.
          </p>
        </div>
      </div>
    </div>
  );
}
/** Per-host nudge / welcome — used from roster rows */
export function HostMessageButtons({
  teamName,
  inviteUrl,
  leaderName,
  hostName,
  onToast,
}: {
  teamName: string;
  inviteUrl: string;
  leaderName?: string;
  hostName: string;
  onToast?: (msg: string) => void;
}) {
  const ctx: TeamShareContext = { teamName, inviteUrl, leaderName };
  return (
    <div className="flex flex-wrap gap-1.5">
      <button
        type="button"
        className="rounded-md border border-[var(--blyp-line)] px-2 py-1 text-[10px] font-semibold"
        onClick={async () => {
          const ok = await writeClipboard(
            welcomeAfterAccept(ctx, hostName),
          );
          onToast?.(ok ? "Welcome copied" : "Copy failed");
        }}
      >
        Welcome
      </button>
      <button
        type="button"
        className="rounded-md border border-[var(--blyp-rose)]/30 px-2 py-1 text-[10px] font-semibold text-[var(--blyp-rose)]"
        onClick={async () => {
          const ok = await writeClipboard(nudgeInactiveBlurb(ctx, hostName));
          onToast?.(ok ? "Nudge copied" : "Copy failed");
        }}
      >
        Nudge
      </button>
    </div>
  );
}
