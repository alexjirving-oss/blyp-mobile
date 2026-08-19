"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
  type SVGProps,
} from "react";
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
import { StudioLaunchButton } from "./StudioLaunchButton";
import "./site-chrome.css";

const NAV = [
  { href: "/foryou", label: "For You", icon: "home" as const },
  { href: "/explore", label: "Explore", icon: "compass" as const },
  { href: "/following", label: "Following", icon: "following" as const },
  { href: "/live", label: "LIVE", icon: "live" as const },
  { href: "/friends", label: "Friends", icon: "friends" as const },
  { href: "/activity", label: "Activity", icon: "activity" as const, badgeKey: "activity" as const },
  { href: "/inbox", label: "Messages", icon: "messages" as const, badgeKey: "messages" as const },
  { href: "/teams", label: "Teams", icon: "teams" as const },
  { href: "/upload", label: "Upload", icon: "upload" as const },
] as const;

type NavIcon = (typeof NAV)[number]["icon"] | "profile";

function formatBadge(n: number) {
  if (n <= 0) return null;
  if (n > 99) return "99+";
  return String(n);
}

function Avatar({
  src,
  name,
  className,
}: {
  src: string | null;
  name: string;
  className: string;
}) {
  return (
    <span className={className}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" />
      ) : (
        (name || "B").slice(0, 1).toUpperCase()
      )}
    </span>
  );
}

function Icon({
  name,
  ...rest
}: { name: NavIcon } & SVGProps<SVGSVGElement>) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    ...rest,
  };
  switch (name) {
    case "home":
      return (
        <svg {...common}>
          <path d="M4 11.5 12 4l8 7.5" />
          <path d="M6.5 10.5V20h11V10.5" />
        </svg>
      );
    case "compass":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="m15.5 8.5-2 7-7 2 2-7 7-2Z" />
        </svg>
      );
    case "following":
      return (
        <svg {...common}>
          <circle cx="9" cy="8.5" r="3" />
          <path d="M4 18.5c.6-3 2.6-4.5 5-4.5s4.4 1.5 5 4.5" />
          <circle cx="17" cy="9" r="2.2" />
          <path d="M16.2 14.2c1.8.4 3.1 1.6 3.6 4.3" />
        </svg>
      );
    case "live":
      return (
        <svg {...common}>
          <path d="M5 12a7 7 0 0 1 14 0" />
          <path d="M8 12a4 4 0 0 1 8 0" />
          <circle cx="12" cy="12" r="1.4" fill="currentColor" />
        </svg>
      );
    case "friends":
      return (
        <svg {...common}>
          <circle cx="8" cy="9" r="2.6" />
          <circle cx="16" cy="9" r="2.6" />
          <path d="M3.8 18c.5-2.6 2.3-4 4.4-4s3.9 1.4 4.4 4" />
          <path d="M11.4 18c.5-2.6 2.3-4 4.4-4s3.9 1.4 4.4 4" />
        </svg>
      );
    case "activity":
      return (
        <svg {...common}>
          <path d="M15 18.2A6.4 6.4 0 0 0 18.5 13V11a6.5 6.5 0 0 0-13 0v2A6.4 6.4 0 0 0 9 18.2" />
          <path d="M9 18.2h6" />
          <path d="M12 4v1.4" />
        </svg>
      );
    case "messages":
      return (
        <svg {...common}>
          <path d="M5 17.5 6.2 14A7.5 7.5 0 1 1 12 19.5H7.2L5 17.5Z" />
        </svg>
      );
    case "teams":
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="2.4" />
          <circle cx="6.2" cy="9.2" r="2" />
          <circle cx="17.8" cy="9.2" r="2" />
          <path d="M8.2 17.8c.5-2.4 2-3.6 3.8-3.6s3.3 1.2 3.8 3.6" />
          <path d="M3.6 17.4c.4-1.8 1.6-2.8 3-2.8" />
          <path d="M17.4 14.6c1.4 0 2.6 1 3 2.8" />
        </svg>
      );
    case "upload":
      return (
        <svg {...common}>
          <path d="M12 19V6" />
          <path d="m7 11 5-5 5 5" />
        </svg>
      );
    case "profile":
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="3.2" />
          <path d="M5 19c.7-3.2 3.2-5 7-5s6.3 1.8 7 5" />
        </svg>
      );
    default:
      return null;
  }
}

function SearchField({
  placeholder,
  className,
}: {
  placeholder: string;
  className: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    router.push(term ? `/search?q=${encodeURIComponent(term)}` : "/search");
  };
  return (
    <form className={className} onSubmit={onSubmit} role="search">
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden
      >
        <circle cx="11" cy="11" r="6.5" />
        <path d="m16 16 4 4" strokeLinecap="round" />
      </svg>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
    </form>
  );
}

function NavLink({
  href,
  label,
  icon,
  active,
  badge,
  liveMark,
}: {
  href: string;
  label: string;
  icon: NavIcon;
  active: boolean;
  badge?: number;
  liveMark?: boolean;
}) {
  const badgeText = formatBadge(badge || 0);
  return (
    <Link
      href={href}
      className={`sc-nav-item${active ? " is-active" : ""}`}
    >
      <Icon name={icon} />
      <span>{label}</span>
      {liveMark ? <span className="sc-nav-live">LIVE</span> : null}
      {!liveMark && badgeText ? (
        <span className="sc-nav-badge">{badgeText}</span>
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
    <div className="sc-follow">
      <p className="sc-follow-label">Following accounts</p>
      {!session ? (
        <p className="sc-follow-hint">Log in to see people you follow.</p>
      ) : accounts === null ? (
        <p className="sc-follow-hint">Loading…</p>
      ) : !accounts.length ? (
        <p className="sc-follow-hint">
          Not following anyone yet. Find creators in Explore.
        </p>
      ) : (
        <ul className="blyp-scroll-hidden sc-follow-list">
          {accounts.map((p) => {
            const letter = (p.displayName || p.username || "B")
              .slice(0, 1)
              .toUpperCase();
            return (
              <li key={p.userId}>
                <Link
                  href={`/u/${encodeURIComponent(p.username)}`}
                  className="sc-follow-row"
                >
                  {p.photoURL ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.photoURL}
                      alt=""
                      className="sc-avatar sc-follow-ava"
                    />
                  ) : (
                    <div className="sc-avatar sc-follow-ava">{letter}</div>
                  )}
                  <div className="sc-follow-meta">
                    <p className="sc-follow-name">
                      {p.displayName || p.username}
                    </p>
                    <p className="sc-follow-handle">@{p.username}</p>
                  </div>
                  {p.isLive ? (
                    <span className="sc-nav-live">LIVE</span>
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

/** Full-width studio dashboard — no product sidebar, header, or mobile tab bar. */
function isBareStudioPath(pathname: string): boolean {
  return (
    pathname.startsWith("/live/blyp-studio") ||
    pathname.startsWith("/live/studio")
  );
}

/** Homepage owns its three-column chrome so SiteChrome does not double the nav. */
function isHomeDashboardPath(pathname: string): boolean {
  return pathname === "/";
}

function ChromeInner({ children }: { children: ReactNode }) {
  const { session, me, logout } = useAuth();
  const pathname = usePathname() || "/";
  const badges = useNavBadges();

  if (isBareStudioPath(pathname)) {
    return (
      <>
        {children}
        <SoftGateModal />
      </>
    );
  }
  const homeDashboard = isHomeDashboardPath(pathname);
  const username = me?.username || session?.username || "";
  const profileHref = username
    ? `/u/${encodeURIComponent(username)}`
    : session
      ? "/"
      : "/login";
  const photoURL = me?.photoURL || null;
  const isFeed =
    pathname.startsWith("/foryou") ||
    pathname.startsWith("/following") ||
    pathname.startsWith("/v/");
  const isImmersiveChrome =
    pathname.startsWith("/foryou") || pathname.startsWith("/following");

  const who =
    me?.displayName || me?.username || session?.username || "You";

  const dock = (
    <nav className="sc-dock" aria-label="Mobile">
      {(
        [
          ["/", "Home", undefined as number | undefined],
          ["/live", "LIVE", undefined],
          ["/wallet", "Coins", undefined],
          ["/inbox", "Inbox", badges.messages],
          [profileHref, "Me", undefined],
        ] as const
      ).map(([href, label, badge]) => {
        const badgeText = formatBadge(Number(badge) || 0);
        const pathBase = String(href).split("?")[0]!;
        const active =
          pathBase === "/"
            ? pathname === "/"
            : pathname === pathBase ||
              pathname.startsWith(`${pathBase}/`);
        return (
          <Link
            key={String(href)}
            href={String(href)}
            className={`sc-dock-item${active ? " is-active" : ""}${
              label === "Coins" ? " is-coins" : ""
            }`}
          >
            {label}
            {badgeText ? (
              <span className="sc-dock-badge">{badgeText}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );

  if (homeDashboard) {
    return (
      <div className="min-h-dvh bg-[var(--blyp-ink)] text-[var(--blyp-fog)]">
        <div className="min-h-dvh">
          <div className="relative flex min-h-dvh min-w-0 flex-1 flex-col">
            <main className="min-h-dvh pb-[4.5rem] md:pb-0">{children}</main>
          </div>
        </div>
        {dock}
        <SoftGateModal />
      </div>
    );
  }

  return (
    <div className="sc-shell">
      <div className="sc-frame">
        <aside className="sc-side">
          <Link href="/" className="sc-logo">
            blyp
            <span className="sc-logo-dot" />
          </Link>
          <SearchField placeholder="Search blyp" className="sc-search" />
          <div className="blyp-scroll-hidden flex min-h-0 flex-1 flex-col overflow-y-auto">
            <nav className="sc-nav" aria-label="Blyp">
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
                    icon={item.icon}
                    badge={badge}
                    liveMark={item.href === "/live"}
                    active={
                      pathname === item.href ||
                      pathname.startsWith(`${item.href}/`) ||
                      (item.href === "/foryou" && pathname.startsWith("/v/"))
                    }
                  />
                );
              })}
              <NavLink
                href={profileHref}
                label="Profile"
                icon="profile"
                active={pathname.startsWith("/u/")}
              />
            </nav>
            <FollowingAccountsStrip />
          </div>
          <div className="sc-side-foot">
            {session ? (
              <Link href={profileHref} className="sc-profile">
                <Avatar src={photoURL} name={who} className="sc-avatar" />
                <span className="sc-profile-meta">
                  <p className="sc-profile-name">{who}</p>
                  <p className="sc-profile-handle">
                    @{me?.username || "me"}
                  </p>
                </span>
              </Link>
            ) : (
              <Link href="/login" className="sc-profile">
                <span className="sc-avatar">B</span>
                <span className="sc-profile-meta">
                  <p className="sc-profile-name">Guest</p>
                  <p className="sc-profile-handle">Log in to sync wallet</p>
                </span>
              </Link>
            )}
            {session ? (
              <HeaderWalletChip className="sc-wallet-pill" />
            ) : null}
            {session ? (
              <button type="button" onClick={logout} className="sc-logout">
                Log out
              </button>
            ) : (
              <Link href="/login" className="sc-login">
                Log in
              </Link>
            )}
          </div>
        </aside>

        <div className="sc-main-col">
          {!isImmersiveChrome ? (
            <header className="sc-top">
              <Link href="/" className="sc-top-logo">
                blyp
                <span className="sc-logo-dot" />
              </Link>
              <SearchField
                placeholder="Search creators, teams, lives..."
                className="sc-search sc-top-search"
              />
              <div className="sc-top-actions">
                <StudioLaunchButton />
                <HeaderWalletChip className="sc-wallet-pill" compact />
                <Link href="/upload" className="sc-icon-btn" aria-label="Upload">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden
                  >
                    <path d="M12 19V6" strokeLinecap="round" />
                    <path d="m7 11 5-5 5 5" strokeLinecap="round" />
                  </svg>
                </Link>
                {session ? (
                  <Link
                    href={profileHref}
                    aria-label={me?.displayName || session.username || "Profile"}
                  >
                    <Avatar
                      src={photoURL}
                      name={who}
                      className="sc-avatar-sm is-online"
                    />
                  </Link>
                ) : (
                  <Link href="/login" className="sc-login" style={{ marginTop: 0 }}>
                    Log in
                  </Link>
                )}
              </div>
            </header>
          ) : (
            <div className="sc-float">
              <StudioLaunchButton compact />
              <HeaderWalletChip className="sc-wallet-pill" compact />
              <Link href="/upload" className="sc-icon-btn" aria-label="Upload">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden
                >
                  <path d="M12 19V6" strokeLinecap="round" />
                  <path d="m7 11 5-5 5 5" strokeLinecap="round" />
                </svg>
              </Link>
              {session ? (
                <Link
                  href={profileHref}
                  aria-label={me?.displayName || me?.username || "Profile"}
                >
                  <Avatar
                    src={photoURL}
                    name={who}
                    className="sc-avatar-sm is-online"
                  />
                </Link>
              ) : (
                <Link href="/login" className="sc-login">
                  Log in
                </Link>
              )}
            </div>
          )}

          <main
            className={
              isFeed
                ? isImmersiveChrome
                  ? "relative h-[100dvh] min-h-0 flex-1 overflow-hidden bg-black pb-[3.25rem] md:pb-0"
                  : "relative min-h-0 flex-1 overflow-hidden bg-black"
                : "blyp-scroll-hidden min-h-0 flex-1 overflow-y-auto pb-[4.5rem] md:pb-0"
            }
          >
            {children}
          </main>
        </div>
      </div>
      {dock}
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
