"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { AuthProvider, useAuth } from "./AuthProvider";
import { SoftGateModal } from "./SoftGateModal";
import { CONTACT_EMAIL, PLAY_STORE_URL } from "@/lib/site";

const NAV = [
  { href: "/foryou/", label: "For You" },
  { href: "/live/", label: "LIVE" },
  { href: "/search/", label: "Search" },
  { href: "/wallet/", label: "Coins" },
] as const;

const FOOTER = [
  { href: "/about/", label: "About" },
  { href: "/download/", label: "Download" },
  { href: "/live/", label: "LIVE" },
  { href: "/foryou/", label: "For You" },
] as const;

function ChromeInner({ children }: { children: ReactNode }) {
  const { session, logout } = useAuth();

  return (
    <div className="flex min-h-screen flex-col text-[var(--blyp-fog)]">
      <header className="sticky top-0 z-40 border-b border-[var(--blyp-line)] bg-[rgba(7,7,10,0.82)] backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-6 px-5">
          <Link
            href="/"
            className="font-display text-2xl font-extrabold tracking-tight"
            aria-label="Blyp home"
          >
            blyp
            <span className="ml-0.5 inline-block h-2 w-2 rounded-full bg-[var(--blyp-teal)] align-middle" />
          </Link>
          <nav
            className="hidden items-center gap-6 text-sm font-medium text-[var(--blyp-muted)] md:flex"
            aria-label="Primary"
          >
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="transition-colors hover:text-[var(--blyp-fog)]"
              >
                {item.label}
              </Link>
            ))}
            <Link
              href="/about/"
              className="transition-colors hover:text-[var(--blyp-fog)]"
            >
              About
            </Link>
          </nav>
          <div className="flex items-center gap-3">
            {session ? (
              <button
                type="button"
                onClick={logout}
                className="hidden text-sm font-medium text-[var(--blyp-muted)] transition-colors hover:text-[var(--blyp-fog)] sm:inline"
              >
                Log out
              </button>
            ) : (
              <Link
                href="/login/"
                className="hidden text-sm font-medium text-[var(--blyp-muted)] transition-colors hover:text-[var(--blyp-fog)] sm:inline"
              >
                Log in
              </Link>
            )}
            <Link
              href="/foryou/"
              className="rounded-full bg-[var(--blyp-teal)] px-4 py-2 text-sm font-semibold text-[var(--blyp-ink)] transition hover:bg-[var(--blyp-teal-deep)] hover:text-[var(--blyp-fog)]"
            >
              Watch
            </Link>
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-[var(--blyp-line)] py-10">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-6 px-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="font-display text-lg font-bold tracking-tight">
              Blyp
              <span className="ml-0.5 inline-block h-1.5 w-1.5 rounded-full bg-[var(--blyp-teal)] align-middle" />
            </p>
            <p className="mt-2 max-w-xs text-sm text-[var(--blyp-muted)]">
              Short video, LIVE, and coins — on the web and on Google Play.
            </p>
          </div>
          <nav
            className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-[var(--blyp-muted)]"
            aria-label="Footer"
          >
            {FOOTER.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="hover:text-[var(--blyp-fog)]"
              >
                {item.label}
              </Link>
            ))}
            <a
              href={PLAY_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-[var(--blyp-fog)]"
            >
              Google Play
            </a>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="hover:text-[var(--blyp-fog)]"
            >
              Contact
            </a>
          </nav>
        </div>
        <p className="mx-auto mt-8 max-w-[1200px] px-5 text-xs text-[var(--blyp-muted)]">
          © {new Date().getFullYear()} Blyp · Spelled B-L-Y-P ·{" "}
          <a href="https://blyp.world/" className="hover:text-[var(--blyp-fog)]">
            blyp.world
          </a>
        </p>
      </footer>
      <SoftGateModal />
    </div>
  );
}

export function SiteChrome({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <ChromeInner>{children}</ChromeInner>
    </AuthProvider>
  );
}
