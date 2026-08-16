import type { Metadata } from "next";
import Link from "next/link";
import {
  CONTACT_EMAIL,
  DEFAULT_DESCRIPTION,
  DEFAULT_TITLE,
  OG_IMAGE_PATH,
  PLAY_STORE_URL,
  SITE_URL,
} from "@/lib/site";

export const metadata: Metadata = {
  title: DEFAULT_TITLE,
  description: DEFAULT_DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    url: SITE_URL,
    images: [{ url: OG_IMAGE_PATH }],
  },
};

export default function HomePage() {
  return (
    <section className="relative min-h-[calc(100vh-4rem)] overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,rgba(0,210,190,0.12),transparent_45%),linear-gradient(300deg,rgba(240,160,184,0.1),transparent_40%)]"
      />
      <div className="relative mx-auto flex min-h-[calc(100vh-4rem)] max-w-[1200px] flex-col justify-end px-5 pb-16 pt-20 md:justify-center md:pb-24">
        <p className="font-display mb-4 text-sm font-semibold uppercase tracking-[0.28em] text-[var(--blyp-teal)]">
          Blyp
        </p>
        <h1 className="font-display max-w-[14ch] text-5xl font-extrabold leading-[0.95] tracking-tight text-[var(--blyp-fog)] sm:text-7xl md:text-8xl">
          Watch. Live. Gift.
        </h1>
        <p className="mt-6 max-w-md text-lg leading-relaxed text-[var(--blyp-muted)]">
          Blyp is a short-video and live-streaming product — For You, LIVE,
          Stage, and coins — on the web at blyp.world and on Google Play.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-4">
          <Link
            href="/foryou/"
            className="rounded-full bg-[var(--blyp-teal)] px-7 py-3.5 text-base font-semibold text-[var(--blyp-ink)] transition hover:bg-[var(--blyp-teal-deep)] hover:text-[var(--blyp-fog)]"
          >
            Open For You
          </Link>
          <Link
            href="/live/"
            className="rounded-full border border-[var(--blyp-line)] px-7 py-3.5 text-base font-semibold text-[var(--blyp-fog)] transition hover:border-[var(--blyp-teal)]"
          >
            LIVE
          </Link>
          <a
            href={PLAY_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-[var(--blyp-line)] px-7 py-3.5 text-base font-semibold text-[var(--blyp-fog)] transition hover:border-[var(--blyp-teal)]"
          >
            Get the app
          </a>
        </div>
        <p className="mt-8 max-w-lg text-sm text-[var(--blyp-muted)]">
          New here?{" "}
          <Link href="/about/" className="text-[var(--blyp-teal)] underline-offset-2 hover:underline">
            About Blyp
          </Link>
          {" · "}
          <Link href="/download/" className="text-[var(--blyp-teal)] underline-offset-2 hover:underline">
            Download
          </Link>
          {" · "}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="text-[var(--blyp-teal)] underline-offset-2 hover:underline"
          >
            {CONTACT_EMAIL}
          </a>
        </p>
      </div>
    </section>
  );
}
