"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AuthProvider, useAuth } from "./AuthProvider";
import { SoftGateModal } from "./SoftGateModal";

const NAV = [
  { href: "/foryou", label: "For You" },
  { href: "/live", label: "LIVE" },
  { href: "/search", label: "Search" },
  { href: "/wallet", label: "Coins" },
] as const;

/** Full-viewport host UIs — no site header (auth still available). */
function isBareStudioPath(pathname: string): boolean {
  return (
    pathname.startsWith("/live/blyp-studio") ||
    pathname.startsWith("/live/studio")
  );
}

function ChromeInner({ children }: { children: ReactNode }) {
  const { session, logout } = useAuth();
  const pathname = usePathname() || "/";

  if (isBareStudioPath(pathname)) {
    return (
      <>
        {children}
        <SoftGateModal />
      </>
    );
  }

  return (
    <div className="min-h-screen text-[var(--blyp-fog)]">
      <header className="sticky top-0 z-40 border-b border-[var(--blyp-line)] bg-[rgba(7,7,10,0.82)] backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-6 px-5">
          <Link
            href="/"
            className="font-display text-2xl font-extrabold tracking-tight"
          >
            blyp
            <span className="ml-0.5 inline-block h-2 w-2 rounded-full bg-[var(--blyp-teal)] align-middle" />
          </Link>
          <nav className="hidden items-center gap-6 text-sm font-medium text-[var(--blyp-muted)] md:flex">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="transition-colors hover:text-[var(--blyp-fog)]"
              >
                {item.label}
              </Link>
            ))}
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
                href="/login"
                className="hidden text-sm font-medium text-[var(--blyp-muted)] transition-colors hover:text-[var(--blyp-fog)] sm:inline"
              >
                Log in
              </Link>
            )}
            <Link
              href="/foryou"
              className="rounded-full bg-[var(--blyp-teal)] px-4 py-2 text-sm font-semibold text-[var(--blyp-ink)] transition hover:bg-[var(--blyp-teal-deep)] hover:text-[var(--blyp-fog)]"
            >
              Watch
            </Link>
          </div>
        </div>
      </header>
      <main>{children}</main>
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
