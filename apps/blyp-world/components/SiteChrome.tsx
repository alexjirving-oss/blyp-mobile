"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  getUnreadActivityCount,
} from "@/lib/activity";
import { ensureFirebaseFromCognito } from "@/lib/firebaseBridge";
import { subscribeThreads } from "@/lib/messaging";
import {
  getFollowingIds,
  hydrateProfiles,
  type SocialProfile,
} from "@/lib/social";
import { AuthProvider, useAuth } from "./AuthProvider";
import { SoftGateModal } from "./SoftGateModal";
import { HeaderWalletChip } from "./HeaderWalletChip";

const NAV = [
  { href: "/foryou", label: "For You" },
  { href: "/explore", label: "Explore" },
  { href: "/following", label: "Following" },
  { href: "/live", label: "LIVE" },
  { href: "/friends", label: "Friends" },
  { href: "/activity", label: "Activity", badgeKey: "activity" as const },
  { href: "/inbox", label: "Messages", badgeKey: "messages" as const },
  { href: "/teams", label: "Teams" },
  { href: "/upload", label: "Upload" },
] as const;

function formatBadge(n: number) {
  if (n <= 0) return null;
  if (n > 99) return "99+";
  return String(n);
}

function NavLink({
  href,
  label,
  active,
  badge,
}: {
  href: string;
  label: string;
  active: boolean;
  badge?: number;
}) {
  const badgeText = formatBadge(badge || 0);
  return (
    <Link
      href={href}
      className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-[15px] font-semibold transition ${
        active
          ? "bg-[rgba(0,210,190,0.12)] text-[var(--blyp-teal)]"
          : "text-[var(--blyp-fog)] hover:bg-white/[0.04]"
      }`}
    >
      <span>{label}</span>
      {badgeText ? (
        <span className="min-w-[1.25rem] rounded-full bg-[#fe2c55] px-1.5 py-0.5 text-center text-[10px] font-bold leading-none text-white">
          {badgeText}
        </span>
      ) : null}
    </Link>
  );
}

function FollowingAccountsStrip() {
  const { session, loading, firebaseReady } = useAuth();
  const [accounts, setAccounts] = useState<SocialProfile[] | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!session?.sub) {
      setAccounts([]);
      return;
    }
    let alive = true;
    (async () => {
      try {
        if (!firebaseReady) {
          await ensureFirebaseFromCognito({
            cognitoIdToken: session.idToken,
            uid: session.sub,
          });
        }
        const ids = await getFollowingIds(session.sub);
        const profiles = await hydrateProfiles(ids.slice(0, 24));
        if (alive) setAccounts(profiles);
      } catch {
        if (alive) setAccounts([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [loading, session, firebaseReady]);

  return (
    <div className="mt-4 border-t border-[var(--blyp-line)] pt-3">
      <p className="px-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--blyp-muted)]">
        Following accounts
      </p>
      {!session ? (
        <p className="mt-2 px-3 text-xs leading-relaxed text-[var(--blyp-muted)]">
          Log in to see people you follow.
        </p>
      ) : accounts === null ? (
        <p className="mt-2 px-3 text-xs text-[var(--blyp-muted)]">Loading…</p>
      ) : !accounts.length ? (
        <p className="mt-2 px-3 text-xs leading-relaxed text-[var(--blyp-muted)]">
          Not following anyone yet. Find creators in Explore.
        </p>
      ) : (
        <ul className="mt-2 max-h-[220px] space-y-0.5 overflow-y-auto">
          {accounts.map((p) => {
            const letter = (p.displayName || p.username || "B")
              .slice(0, 1)
              .toUpperCase();
            return (
              <li key={p.userId}>
                <Link
                  href={`/u/${encodeURIComponent(p.username)}`}
                  className="flex items-center gap-2.5 rounded-xl px-2.5 py-1.5 hover:bg-white/[0.04]"
                >
                  {p.photoURL ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.photoURL}
                      alt=""
                      className="h-8 w-8 rounded-full object-cover"
                    />
                  ) : (
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--blyp-teal)] text-[11px] font-bold text-[var(--blyp-ink)]">
                      {letter}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold">
                      {p.displayName || p.username}
                    </p>
                    <p className="truncate text-[11px] text-[var(--blyp-muted)]">
                      @{p.username}
                    </p>
                  </div>
                  {p.isLive ? (
                    <span className="rounded bg-red-500 px-1 py-0.5 text-[9px] font-bold uppercase text-white">
                      Live
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function useNavBadges() {
  const { session, loading, firebaseReady } = useAuth();
  const [messages, setMessages] = useState(0);
  const [activity, setActivity] = useState(0);

  useEffect(() => {
    if (loading || !session?.sub) {
      setMessages(0);
      setActivity(0);
      return;
    }

    let alive = true;
    let unsub: (() => void) | undefined;

    (async () => {
      try {
        if (!firebaseReady) {
          await ensureFirebaseFromCognito({
            cognitoIdToken: session.idToken,
            uid: session.sub,
          });
        }
        if (!alive) return;

        unsub = subscribeThreads(
          session.sub,
          (threads) => {
            if (!alive) return;
            const total = threads.reduce(
              (sum, t) => sum + (Number(t.unreadCount) || 0),
              0,
            );
            setMessages(total);
          },
          () => {
            if (alive) setMessages(0);
          },
        );

        const unread = await getUnreadActivityCount(session.sub);
        if (alive) setActivity(unread);
      } catch {
        if (alive) {
          setMessages(0);
          setActivity(0);
        }
      }
    })();

    const refresh = window.setInterval(() => {
      if (!session?.sub) return;
      void getUnreadActivityCount(session.sub).then((n) => {
        if (alive) setActivity(n);
      });
    }, 90_000);

    return () => {
      alive = false;
      try {
        unsub?.();
      } catch {
        /* ignore */
      }
      window.clearInterval(refresh);
    };
  }, [loading, session, firebaseReady]);

  return { messages, activity };
}

/** Grid 9 wireframe only — do not wrap the rest of the product in studio chrome. */
function isBareBlypStudioPath(pathname: string): boolean {
  return pathname.startsWith("/live/blyp-studio");
}

function ChromeInner({ children }: { children: ReactNode }) {
  const { session, me, logout } = useAuth();
  const pathname = usePathname() || "/";
  const badges = useNavBadges();

  if (isBareBlypStudioPath(pathname)) {
    return (
      <>
        {children}
        <SoftGateModal />
      </>
    );
  }
  const profileHref = session
    ? `/u/${encodeURIComponent(me?.username || session.username || "me")}`
    : "/login";
  const avatarLetter = (
    me?.displayName ||
    me?.username ||
    session?.username ||
    "B"
  )
    .slice(0, 1)
    .toUpperCase();
  const photoURL = me?.photoURL || null;
  const isFeed =
    pathname === "/" ||
    pathname.startsWith("/foryou") ||
    pathname.startsWith("/following") ||
    pathname.startsWith("/v/");
  // For You / Following: hide top search chrome so the stage owns the viewport.
  const isImmersiveFeed =
    pathname === "/" ||
    pathname.startsWith("/foryou") ||
    pathname.startsWith("/following");

  return (
    <div className="min-h-dvh bg-[var(--blyp-ink)] text-[var(--blyp-fog)]">
      <div className="mx-auto flex min-h-dvh max-w-[1600px]">
        <aside className="sticky top-0 z-20 hidden h-dvh w-[220px] shrink-0 flex-col border-r border-[var(--blyp-line)] bg-[var(--blyp-ink)] px-3 py-4 lg:w-[240px] md:flex">
          <Link href="/foryou" className="font-display mb-4 px-3 text-3xl font-extrabold tracking-tight">
            blyp
            <span className="ml-0.5 inline-block h-2.5 w-2.5 rounded-full bg-[var(--blyp-teal)] align-middle" />
          </Link>
          <Link href="/search" className="mb-4 block px-1">
            <div className="rounded-full border border-[var(--blyp-line)] bg-[var(--blyp-ink-elevated)] px-3 py-2 text-sm text-[var(--blyp-muted)]">
              Search
            </div>
          </Link>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <nav className="flex flex-col gap-0.5">
              {NAV.map((item) => {
                const badge =
                  "badgeKey" in item && item.badgeKey === "messages"
                    ? badges.messages
                    : "badgeKey" in item && item.badgeKey === "activity"
                      ? badges.activity
                      : undefined;
                return (
                  <NavLink
                    key={item.href}
                    href={item.href}
                    label={item.label}
                    badge={badge}
                    active={
                      pathname === item.href ||
                      pathname.startsWith(`${item.href}/`) ||
                      (item.href === "/foryou" &&
                        (pathname === "/" || pathname.startsWith("/v/")))
                    }
                  />
                );
              })}
              <NavLink
                href={profileHref}
                label="Profile"
                active={pathname.startsWith("/u/")}
              />
            </nav>
            <FollowingAccountsStrip />
          </div>
          <div className="mt-auto shrink-0 space-y-2 border-t border-[var(--blyp-line)] pt-3">
            {session ? (
              <Link
                href={profileHref}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-white/[0.04]"
              >
                {photoURL ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={photoURL}
                    alt=""
                    className="h-9 w-9 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--blyp-teal)] text-sm font-bold text-[var(--blyp-ink)]">
                    {avatarLetter}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {me?.displayName || me?.username || "You"}
                  </p>
                  <p className="truncate text-xs text-[var(--blyp-muted)]">
                    @{me?.username || "me"}
                  </p>
                </div>
              </Link>
            ) : null}
            <HeaderWalletChip className="flex w-full items-center justify-center rounded-full bg-[var(--blyp-teal)] px-4 py-2.5 text-sm font-bold text-[var(--blyp-ink)]" />
            {session ? (
              <button
                type="button"
                onClick={logout}
                className="w-full rounded-full border border-[var(--blyp-line)] px-4 py-2 text-sm font-semibold text-[var(--blyp-muted)]"
              >
                Log out
              </button>
            ) : (
              <Link
                href="/login"
                className="flex w-full items-center justify-center rounded-full border border-[var(--blyp-line)] px-4 py-2 text-sm font-semibold"
              >
                Log in
              </Link>
            )}
          </div>
        </aside>

        <div className="relative flex min-h-dvh min-w-0 flex-1 flex-col">
          {!isImmersiveFeed ? (
            <header className="flex h-14 items-center justify-between gap-3 border-b border-[var(--blyp-line)] px-4 md:h-16 md:px-6">
              <Link href="/search" className="min-w-0 flex-1 md:max-w-md">
                <div className="rounded-full border border-[var(--blyp-line)] bg-[var(--blyp-ink-elevated)] px-4 py-2 text-sm text-[var(--blyp-muted)]">
                  Search
                </div>
              </Link>
              <div className="flex shrink-0 items-center gap-2">
                <HeaderWalletChip
                  className="rounded-full bg-[var(--blyp-teal)] px-3 py-2 text-sm font-bold text-[var(--blyp-ink)] sm:px-4"
                  compact
                />
                <Link
                  href="/upload"
                  className="hidden rounded-full bg-white/10 px-4 py-2 text-sm font-semibold sm:inline"
                >
                  Upload
                </Link>
                {session ? (
                  <Link
                    href={profileHref}
                    className="flex h-9 w-9 overflow-hidden rounded-full bg-[var(--blyp-teal)] text-sm font-bold text-[var(--blyp-ink)]"
                    title={me?.displayName || session.username || "Profile"}
                  >
                    {photoURL ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={photoURL}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center">
                        {avatarLetter}
                      </span>
                    )}
                  </Link>
                ) : (
                  <Link
                    href="/login"
                    className="rounded-full border border-[var(--blyp-line)] px-3 py-2 text-sm font-semibold sm:px-4"
                  >
                    Log in
                  </Link>
                )}
              </div>
            </header>
          ) : (
            <div className="absolute right-3 top-3 z-30 flex items-center gap-2">
              {/* TikTok-style Get Coins — always visible on mobile feed */}
              <HeaderWalletChip
                className="rounded-full bg-[var(--blyp-teal)] px-3 py-1.5 text-xs font-bold text-[var(--blyp-ink)] shadow-sm ring-1 ring-black/10 backdrop-blur"
                compact
              />
              <Link
                href="/upload"
                className="hidden rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white ring-1 ring-white/15 backdrop-blur md:inline"
              >
                Upload
              </Link>
              {session ? (
                <Link
                  href={profileHref}
                  className="hidden h-8 w-8 overflow-hidden rounded-full bg-[var(--blyp-teal)] text-xs font-bold text-[var(--blyp-ink)] ring-1 ring-white/20 md:flex"
                  title={me?.displayName || me?.username || "Profile"}
                >
                  {photoURL ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={photoURL}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center">
                      {avatarLetter}
                    </span>
                  )}
                </Link>
              ) : (
                <Link
                  href="/login"
                  className="hidden rounded-full bg-black/40 px-3 py-1.5 text-xs font-bold text-white ring-1 ring-white/15 backdrop-blur md:inline"
                >
                  Log in
                </Link>
              )}
            </div>
          )}

          <main
            className={
              isFeed
                ? isImmersiveFeed
                  ? "relative h-[100dvh] min-h-0 flex-1 overflow-hidden bg-black pb-[3.25rem] md:pb-0"
                  : "relative min-h-0 flex-1 overflow-hidden bg-black"
                : "min-h-0 flex-1 overflow-y-auto pb-[4.5rem] md:pb-0"
            }
          >
            {children}
          </main>
        </div>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-around border-t border-[var(--blyp-line)] bg-[rgba(7,7,10,0.94)] px-1 py-2 backdrop-blur md:hidden">
        {(
          [
            ["/foryou", "Home", undefined as number | undefined],
            ["/live", "LIVE", undefined],
            ["/wallet", "Coins", undefined],
            ["/inbox", "Inbox", badges.messages],
            [profileHref, "Me", undefined],
          ] as const
        ).map(([href, label, badge]) => {
          const badgeText = formatBadge(Number(badge) || 0);
          const pathBase = String(href).split("?")[0]!;
          const active =
            pathname === pathBase ||
            pathname.startsWith(`${pathBase}/`) ||
            (href === "/foryou" && pathname === "/");
          return (
            <Link
              key={String(href)}
              href={String(href)}
              className={`relative px-1.5 py-1 text-xs font-semibold ${
                active
                  ? "text-[var(--blyp-teal)]"
                  : label === "Coins"
                    ? "text-[var(--blyp-gold)]"
                    : "text-[var(--blyp-muted)]"
              }`}
            >
              {label}
              {badgeText ? (
                <span className="absolute -right-1 -top-0.5 min-w-[1rem] rounded-full bg-[#fe2c55] px-1 text-center text-[9px] font-bold leading-[14px] text-white">
                  {badgeText}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
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
