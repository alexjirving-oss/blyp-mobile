import type { Metadata } from "next";
import Link from "next/link";
import {
  ANDROID_PACKAGE_ID,
  DEFAULT_DESCRIPTION,
  OG_IMAGE_PATH,
  PLAY_STORE_URL,
  SITE_URL,
} from "@/lib/site";

export const metadata: Metadata = {
  title: "Download Blyp",
  description:
    "Download the Blyp app on Google Play (com.blyp.mobile), or open For You and LIVE on blyp.world in your browser.",
  alternates: { canonical: "/download/" },
  openGraph: {
    title: "Download Blyp — Google Play & web",
    description: DEFAULT_DESCRIPTION,
    url: `${SITE_URL}/download/`,
    images: [{ url: OG_IMAGE_PATH }],
  },
};

export default function DownloadPage() {
  return (
    <section className="mx-auto max-w-[720px] px-5 py-16">
      <p className="font-display text-sm font-semibold uppercase tracking-[0.28em] text-[var(--blyp-teal)]">
        App
      </p>
      <h1 className="font-display mt-3 text-4xl font-extrabold tracking-tight text-[var(--blyp-fog)] sm:text-5xl">
        Download Blyp
      </h1>
      <p className="mt-4 text-lg leading-relaxed text-[var(--blyp-muted)]">
        Get the Blyp Android app on Google Play, or use the full web product at{" "}
        <Link href="/" className="text-[var(--blyp-teal)] hover:underline">
          blyp.world
        </Link>{" "}
        — no install required for For You and LIVE.
      </p>

      <div className="mt-10 flex flex-wrap gap-4">
        <a
          href={PLAY_STORE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full bg-[var(--blyp-teal)] px-7 py-3.5 text-base font-semibold text-[var(--blyp-ink)] transition hover:bg-[var(--blyp-teal-deep)] hover:text-[var(--blyp-fog)]"
        >
          Open on Google Play
        </a>
        <Link
          href="/foryou/"
          className="rounded-full border border-[var(--blyp-line)] px-7 py-3.5 text-base font-semibold text-[var(--blyp-fog)] transition hover:border-[var(--blyp-teal)]"
        >
          Watch on the web
        </Link>
      </div>

      <dl className="mt-12 space-y-3 text-sm text-[var(--blyp-muted)]">
        <div>
          <dt className="font-semibold text-[var(--blyp-fog)]">Package ID</dt>
          <dd>
            <code className="text-[var(--blyp-teal)]">{ANDROID_PACKAGE_ID}</code>
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-[var(--blyp-fog)]">Store listing</dt>
          <dd>
            <a
              href={PLAY_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all text-[var(--blyp-teal)] hover:underline"
            >
              {PLAY_STORE_URL}
            </a>
          </dd>
        </div>
      </dl>

      <p className="mt-10 text-sm text-[var(--blyp-muted)]">
        Learn more on the{" "}
        <Link href="/about/" className="text-[var(--blyp-teal)] hover:underline">
          About Blyp
        </Link>{" "}
        page.
      </p>
    </section>
  );
}
