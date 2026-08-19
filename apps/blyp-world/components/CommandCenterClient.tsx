"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type SVGProps,
} from "react";
import { useAuth } from "./AuthProvider";
import { ensureFirebaseFromCognito } from "@/lib/firebaseBridge";
import { getFirebaseAuth } from "@/lib/firebase";
import { fetchLiveDirectory, type LiveCard } from "@/lib/live";
import { getUnreadActivityCount } from "@/lib/activity";
import { subscribeThreads } from "@/lib/messaging";
import { getFollowingIds } from "@/lib/social";
import {
  loadMyTeam,
  loadMyTeamViaApi,
  type TeamBundle,
  type TeamMember,
} from "@/lib/teams";
import { PLAY_STORE_URL } from "@/lib/site";
import { StudioLaunchButton } from "./StudioLaunchButton";
import { enterLiveStudio } from "@/lib/enterLiveStudio";
import { fetchWallet, type WalletBalance } from "@/lib/economy";
import {
  AdminStaffError,
  banAdminUser,
  creditAdminCoins,
  fetchAdminStaffMe,
  listOpenAdminReports,
  removeAdminPost,
  searchAdminUsers,
  staffCan,
  type AdminReportRow,
  type AdminStaffMe,
  type AdminUserRow,
} from "@/lib/adminStaff";
import "./home-dashboard.css";
import "./command-center.css";

const HOME_NAV = [
  { href: "/foryou", label: "For You", icon: "home" as const },
  { href: "/explore", label: "Explore", icon: "compass" as const },
  { href: "/following", label: "Following", icon: "following" as const },
  { href: "/live", label: "LIVE", icon: "live" as const },
  { href: "/friends", label: "Friends", icon: "friends" as const },
  {
    href: "/activity",
    label: "Activity",
    icon: "activity" as const,
    badgeKey: "activity" as const,
  },
  {
    href: "/inbox",
    label: "Messages",
    icon: "messages" as const,
    badgeKey: "messages" as const,
  },
  { href: "/teams", label: "Teams", icon: "teams" as const },
] as const;

/** Static export uses trailingSlash: true — bare product paths 404 on Netlify. */
function appHref(href: string) {
  if (href === "/") return "/";
  const q = href.indexOf("?");
  const path = q === -1 ? href : href.slice(0, q);
  const query = q === -1 ? "" : href.slice(q);
  // Watch shells rewrite /live/:id (no slash). /live/abc/ would 404.
  if (/^\/live\/(?!studio(?:\/|$)|blyp-studio(?:\/|$))[^/]+\/?$/.test(path)) {
    return `${path.replace(/\/$/, "")}${query}`;
  }
  const slashed = path.endsWith("/") ? path : `${path}/`;
  return `${slashed}${query}`;
}

function pathKey(href: string) {
  return href.replace(/\/+$/, "") || "/";
}

function letter(name: string) {
  return (name || "B").slice(0, 1).toUpperCase();
}

function formatBadge(n: number) {
  if (n <= 0) return null;
  if (n > 99) return "99+";
  return String(n);
}

function formatCount(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function Icon({
  name,
  ...rest
}: { name: (typeof HOME_NAV)[number]["icon"] } & SVGProps<SVGSVGElement>) {
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
    default:
      return null;
  }
}

function HomeNavList({
  badges,
  compact,
}: {
  badges: { messages: number; activity: number };
  compact?: boolean;
}) {
  const pathname = usePathname() || "/";
  return (
    <nav
      className={compact ? "home-nav-compact" : "home-nav"}
      aria-label={compact ? "Blyp sections" : "Blyp"}
    >
      {HOME_NAV.map((item) => {
        const badge =
          "badgeKey" in item && item.badgeKey === "messages"
            ? badges.messages
            : "badgeKey" in item && item.badgeKey === "activity"
              ? badges.activity
              : 0;
        const badgeText = formatBadge(badge);
        const active = pathKey(pathname) === pathKey(item.href);
        return (
          <Link
            key={item.href}
            href={appHref(item.href)}
            className={`home-nav-item${active ? " is-active" : ""}`}
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
            {item.href === "/live" ? (
              <span className="home-nav-live">LIVE</span>
            ) : badgeText ? (
              <span className="home-nav-badge">{badgeText}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
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
    router.push(term ? `/search/?q=${encodeURIComponent(term)}` : "/search/");
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
        letter(name)
      )}
    </span>
  );
}

function WalletPills({ wallet }: { wallet: WalletBalance | null }) {
  if (!wallet) {
    return (
      <Link href={appHref("/wallet")} className="home-wallet-row">
        <span className="home-wallet-pill">Coins</span>
        <span className="home-wallet-pill is-gem">Gems</span>
      </Link>
    );
  }
  return (
    <Link href={appHref("/wallet")} className="home-wallet-row" aria-label="Open wallet">
      <span className="home-wallet-pill">{wallet.coins.toLocaleString()}</span>
      <span className="home-wallet-pill is-gem">
        {wallet.gems.toLocaleString()}
      </span>
    </Link>
  );
}

function HeaderWalletPills({ wallet }: { wallet: WalletBalance | null }) {
  const coins = wallet ? wallet.coins.toLocaleString() : "…";
  const gems = wallet ? wallet.gems.toLocaleString() : "…";
  return (
    <>
      <Link href={appHref("/wallet")} className="home-wallet-pill" title="Coins">
        {coins}
      </Link>
      <Link href={appHref("/wallet")} className="home-wallet-pill is-gem" title="Gems">
        {gems}
      </Link>
    </>
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
            setMessages(
              threads.reduce((sum, t) => sum + (Number(t.unreadCount) || 0), 0),
            );
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

function LiveNowRow({
  card,
  onJoin,
}: {
  card: LiveCard;
  onJoin: (card: LiveCard) => void;
}) {
  const host = card.hostDisplayName || card.hostUsername;
  return (
    <button type="button" className="home-live-row" onClick={() => onJoin(card)}>
      <span className="home-thumb">
        {card.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={card.thumbnailUrl} alt="" />
        ) : null}
        <span className="home-live-flag">LIVE</span>
        <span className="home-live-viewers">{formatCount(card.viewerCount)}</span>
      </span>
      <span className="home-live-copy">
        <span className="home-live-host">
          <Avatar src={card.hostPhotoURL} name={host} className="home-avatar-sm" />
          {host}
        </span>
        <span className="home-live-title">{card.title}</span>
      </span>
    </button>
  );
}

export function CommandCenterClient() {
  const router = useRouter();
  const { session, me, loading, requireAuth, firebaseReady, logout } = useAuth();
  const badges = useNavBadges();
  const [live, setLive] = useState<LiveCard[] | null>(null);
  const [team, setTeam] = useState<TeamBundle | null>(null);
  const [followingLive, setFollowingLive] = useState<LiveCard[]>([]);
  const [staff, setStaff] = useState<AdminStaffMe | null>(null);
  const [staffError, setStaffError] = useState<string | null>(null);
  const [staffProbed, setStaffProbed] = useState(false);
  const [wallet, setWallet] = useState<WalletBalance | null>(null);

  const signedIn = !!session;
  const who = me?.displayName || me?.username || session?.username || "there";
  const handle = me?.username || session?.username || "me";
  const username = me?.username || session?.username || "";
  const profileHref = username
    ? appHref(`/u/${encodeURIComponent(username)}`)
    : signedIn
      ? "/"
      : appHref("/login");
  const photoURL = me?.photoURL || null;

  const loadDirectory = useCallback(async () => {
    try {
      return await fetchLiveDirectory();
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const cards = await loadDirectory();
      if (alive) setLive(cards);
    };
    void tick();
    const id = window.setInterval(tick, 25_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [loadDirectory, session?.sub, firebaseReady]);

  useEffect(() => {
    if (loading || !session?.sub || !session.idToken) {
      setTeam(null);
      setFollowingLive([]);
      setStaff(null);
      setStaffError(null);
      setStaffProbed(false);
      setWallet(null);
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
        let firebaseUid: string | undefined;
        try {
          firebaseUid = getFirebaseAuth().currentUser?.uid;
        } catch {
          firebaseUid = undefined;
        }
        let bundle: TeamBundle | null = null;
        if (firebaseUid === session.sub) {
          try {
            bundle = await loadMyTeam(session.sub);
          } catch {
            bundle = null;
          }
        }
        if (!bundle) {
          try {
            bundle = await loadMyTeamViaApi(session.idToken);
          } catch {
            bundle = null;
          }
        }
        if (alive) setTeam(bundle);

        try {
          const [ids, cards] = await Promise.all([
            getFollowingIds(session.sub),
            loadDirectory(),
          ]);
          const idSet = new Set(ids);
          if (alive) {
            setFollowingLive(cards.filter((c) => idSet.has(c.hostUid)));
            setLive(cards);
          }
        } catch {
          if (alive) setFollowingLive([]);
        }
      } catch {
        if (alive) {
          setTeam(null);
          setFollowingLive([]);
        }
      }

      try {
        const meStaff = await fetchAdminStaffMe(session.idToken);
        if (alive) {
          setStaff(meStaff);
          setStaffError(null);
          setStaffProbed(true);
        }
      } catch (e) {
        if (alive) {
          setStaff(null);
          setStaffProbed(true);
          setStaffError(
            e instanceof Error
              ? e.message
              : "Could not reach admin APIs from this session",
          );
        }
      }

      try {
        const w = await fetchWallet(session.idToken);
        if (alive) setWallet(w);
      } catch {
        if (alive) setWallet(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [loading, session, firebaseReady, loadDirectory]);

  const gate = useCallback(
    (reason: string) => {
      if (session?.idToken) return false;
      requireAuth(reason);
      return true;
    },
    [session, requireAuth],
  );

  const openStudio = () => {
    if (gate("Log in to go LIVE")) return;
    void enterLiveStudio((href) => router.push(appHref(href)));
  };

  const onJoinLive = (card: LiveCard) => {
    window.location.href = appHref(
      `/live/${encodeURIComponent(card.streamId || card.id)}`,
    );
  };

  const teamLive = useMemo(() => {
    if (!team) return [];
    return team.members.filter((m) => m.isLive);
  }, [team]);

  if (loading) {
    return (
      <div className="home-dash">
        <p className="home-muted" style={{ padding: "2rem" }}>
          Opening Blyp…
        </p>
      </div>
    );
  }

  return (
    <div className="home-dash" data-home-dashboard="1">
      <aside className="home-side">
        <Link href="/" className="home-logo">
          blyp
          <span className="home-logo-dot" />
        </Link>
        <SearchField placeholder="Search blyp" className="home-search" />
        <HomeNavList badges={badges} />
        <div className="home-side-foot">
          {signedIn ? (
            <Link href={profileHref} className="home-profile">
              <Avatar
                src={photoURL}
                name={who}
                className="home-avatar"
              />
              <span className="home-profile-meta">
                <p className="home-profile-name">{who}</p>
                <p className="home-profile-handle">@{handle}</p>
              </span>
            </Link>
          ) : (
            <Link href={appHref("/login")} className="home-profile">
              <span className="home-avatar">B</span>
              <span className="home-profile-meta">
                <p className="home-profile-name">Guest</p>
                <p className="home-profile-handle">Log in to sync wallet</p>
              </span>
            </Link>
          )}
          {signedIn ? <WalletPills wallet={wallet} /> : null}
          {signedIn ? (
            <button type="button" className="home-logout" onClick={logout}>
              Log out
            </button>
          ) : (
            <Link href={appHref("/login")} className="home-login">
              Log in
            </Link>
          )}
        </div>
      </aside>

      <div className="home-main">
        <header className="home-top">
          <Link href="/" className="home-top-logo">
            blyp
            <span className="home-logo-dot" />
          </Link>
          <SearchField
            placeholder="Search creators, teams, lives..."
            className="home-search home-top-search"
          />
          <div className="home-top-actions">
            {signedIn ? (
              <StudioLaunchButton />
            ) : (
              <button
                type="button"
                className="blyp-studio-launch"
                onClick={openStudio}
              >
                <span className="blyp-studio-launch-dot" aria-hidden />
                Live Studio
              </button>
            )}
            {signedIn ? (
              <HeaderWalletPills wallet={wallet} />
            ) : (
              <Link href={appHref("/wallet")} className="home-wallet-pill">
                Coins
              </Link>
            )}
            <Link href={appHref("/upload")} className="home-icon-btn" aria-label="Upload">
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
            {signedIn ? (
              <Link href={profileHref} aria-label="Profile">
                <Avatar
                  src={photoURL}
                  name={who}
                  className="home-avatar-sm is-online"
                />
              </Link>
            ) : (
              <Link href={appHref("/login")} className="home-login">
                Log in
              </Link>
            )}
          </div>
        </header>

        <HomeNavList badges={badges} compact />

        <div className="home-body">
          <div className="home-col">
            <section className="home-card home-hero">
              <div className="home-hero-grid">
                <div>
                  <p className="home-kicker">
                    {signedIn ? `Welcome back, ${who}` : "Blyp"}
                  </p>
                  <h1>WATCH. LIVE. GIFT.</h1>
                  <p>
                    Android app for For You, LIVE, coins, and gifts. Host from
                    this laptop with Live Studio — camera, mic, and screen stay
                    on the real desk.
                  </p>
                  <a
                    href={PLAY_STORE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="home-play"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
                      <path
                        fill="#34a853"
                        d="M3.6 2.4v19.2L13.2 12z"
                      />
                      <path fill="#fbbc04" d="M13.2 12 3.6 21.6 17.4 14z" />
                      <path fill="#4285f4" d="M20.4 10.2 17.4 8.6 13.2 12l4.2 3.4 3-1.8c.8-.5.8-1.9 0-2.4z" />
                      <path fill="#ea4335" d="M3.6 2.4 13.2 12 17.4 8.6z" />
                    </svg>
                    Get it on Google Play
                  </a>
                </div>
                <div className="home-art" aria-hidden>
                  <span className="home-art-phone" />
                  <span className="home-art-gift" />
                  <span className="home-art-gem" />
                </div>
              </div>
            </section>

            <section className="home-card">
              <div className="home-desk-head">
                <div>
                  <p className="home-kicker">Go Live</p>
                  <h2>Laptop host desk</h2>
                  <p>
                    Real IVS studio — camera, mic, screen + camera PIP, guests,
                    chat, gifts. Opens the working desk at /live/studio, not a
                    preview camera on this page.
                  </p>
                </div>
                {signedIn ? (
                  <StudioLaunchButton
                    className="blyp-studio-launch-lg"
                    label="Open Live Studio"
                  />
                ) : (
                  <button
                    type="button"
                    className="blyp-studio-launch blyp-studio-launch-lg"
                    onClick={openStudio}
                  >
                    <span className="blyp-studio-launch-dot" aria-hidden />
                    Sign in to Go Live
                  </button>
                )}
              </div>
              <div className="home-chips">
                <span className="home-chip">
                  <span
                    className="home-chip-dot"
                    style={{ background: "#22d38a" }}
                  />
                  Camera
                </span>
                <span className="home-chip">
                  <span
                    className="home-chip-dot"
                    style={{ background: "var(--home-purple, #b57bff)" }}
                  />
                  Mic
                </span>
                <span className="home-chip">
                  <span
                    className="home-chip-dot"
                    style={{ background: "var(--home-gem, #5b9dff)" }}
                  />
                  Screen
                </span>
              </div>
              <div className="home-program" data-no-getusermedia="1">
                <div className="home-program-stage">
                  <div className="home-ready">
                    <strong>READY</strong>
                    <span>Desk at /live/studio</span>
                  </div>
                </div>
                <div className="home-console">
                  <button type="button" className="home-console-btn" onClick={openStudio}>
                    Camera
                  </button>
                  <button type="button" className="home-console-btn" onClick={openStudio}>
                    Mic
                  </button>
                  <button type="button" className="home-console-btn" onClick={openStudio}>
                    Screen
                  </button>
                  <button type="button" className="home-console-btn" onClick={openStudio}>
                    Guests
                  </button>
                  <button type="button" className="home-console-btn" onClick={openStudio}>
                    Chat
                  </button>
                  <button
                    type="button"
                    className="blyp-studio-launch home-go"
                    onClick={openStudio}
                  >
                    <span className="blyp-studio-launch-dot" aria-hidden />
                    Go Live
                  </button>
                </div>
              </div>
            </section>
          </div>

          <div className="home-col">
            <TeamWidget
              signedIn={signedIn}
              team={team}
              teamLive={teamLive}
              followingLive={followingLive}
              directory={live}
              onJoin={onJoinLive}
              onNeedAuth={gate}
            />

            <section className="home-card">
              <div className="home-card-head">
                <h2>Live Now on Blyp</h2>
                <Link href={appHref("/live")}>View all</Link>
              </div>
              {live === null ? (
                <p className="home-muted">Loading directory…</p>
              ) : live.length ? (
                live.slice(0, 5).map((card) => (
                  <LiveNowRow key={card.id} card={card} onJoin={onJoinLive} />
                ))
              ) : (
                <div className="home-empty">
                  <div className="home-empty-stage" aria-hidden>
                    <span>LIVE</span>
                  </div>
                  <p className="home-muted">
                    {signedIn
                      ? "Nobody is on air right now. Open Live Studio when you want to host."
                      : "The live list stays empty until you sign in. Unsigned visitors don’t get sample streams."}
                  </p>
                  {signedIn ? (
                    <StudioLaunchButton label="Open Live Studio" />
                  ) : (
                    <Link href={appHref("/login")} className="home-quiet-link">
                      Log in to see Live Now →
                    </Link>
                  )}
                </div>
              )}
            </section>

            <section className="home-card">
              <div className="home-app-cta">
                <span className="home-app-ico" aria-hidden>
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  >
                    <rect x="7" y="3" width="10" height="18" rx="2" />
                    <path d="M11 18h2" />
                  </svg>
                </span>
                <div>
                  <p className="home-profile-name" style={{ margin: 0 }}>
                    Download the app
                  </p>
                  <a
                    href={PLAY_STORE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="home-quiet-link"
                  >
                    Google Play
                  </a>
                </div>
              </div>
            </section>

            {signedIn && staff ? (
              <section className="home-card home-staff">
                <AdminGlass
                  demo={false}
                  staff={staff}
                  staffError={staffError}
                  idToken={session?.idToken || null}
                  onNeedAuth={gate}
                />
              </section>
            ) : signedIn && staffProbed && staffError ? (
              <section className="home-card">
                <p className="home-kicker">Staff tools</p>
                <p className="home-muted" style={{ marginTop: "0.5rem" }}>
                  Admin APIs did not accept this session. Use{" "}
                  <a
                    href="https://admin.blyp.world"
                    className="home-quiet-link"
                    target="_blank"
                    rel="noreferrer"
                  >
                    admin.blyp.world
                  </a>{" "}
                  if you are allowlisted staff.
                </p>
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function TeamWidget({
  signedIn,
  team,
  teamLive,
  followingLive,
  directory,
  onJoin,
  onNeedAuth,
}: {
  signedIn: boolean;
  team: TeamBundle | null;
  teamLive: TeamMember[];
  followingLive: LiveCard[];
  directory: LiveCard[] | null;
  onJoin: (card: LiveCard) => void;
  onNeedAuth: (reason: string) => boolean;
}) {
  const memberCards = (directory || [])
    .filter((c) => teamLive.some((m) => m.uid === c.hostUid));

  const title = team?.name ? `${team.name}` : "Your team";

  return (
    <section className="home-card">
      <div className="home-card-head">
        <h2>{signedIn && team ? title : "Teams"}</h2>
        <Link href={appHref("/teams")}>View team</Link>
      </div>

      {!signedIn ? (
        <p className="home-muted">
          Log in to see your roster, who’s live, and the Teams desk. Nothing
          here is a sample agency.
        </p>
      ) : !team ? (
        <p className="home-muted">
          You’re not on a team yet. Open Teams to apply or run a desk.
        </p>
      ) : directory === null ? (
        <p className="home-muted">Checking who’s live…</p>
      ) : (
        <>
          <p
            className="home-kicker"
            style={{ marginTop: "0.15rem", marginBottom: "0.45rem" }}
          >
            Team members live
          </p>
          {memberCards.length ? (
            memberCards.map((card) => (
              <LiveNowRow key={`tm-${card.id}`} card={card} onJoin={onJoin} />
            ))
          ) : (
            <p className="home-muted">Nobody on the roster is live right now.</p>
          )}
          <p
            className="home-kicker"
            style={{ marginTop: "0.95rem", marginBottom: "0.45rem" }}
          >
            Follows who are live
          </p>
          {followingLive.length ? (
            followingLive.map((card) => (
              <LiveNowRow key={`fl-${card.id}`} card={card} onJoin={onJoin} />
            ))
          ) : (
            <p className="home-muted">None of your follows are live.</p>
          )}
        </>
      )}

      <div className="home-pills">
        <Link
          href={appHref("/teams")}
          className="home-pill is-gold"
          onClick={(e) => {
            if (onNeedAuth("Log in to open team battles")) e.preventDefault();
          }}
        >
          Battles
        </Link>
        <Link
          href={appHref("/teams")}
          className="home-pill"
          onClick={(e) => {
            if (onNeedAuth("Log in to open the team diary")) e.preventDefault();
          }}
        >
          Diary / boards
        </Link>
        <Link
          href={appHref("/teams")}
          className="home-pill"
          onClick={(e) => {
            if (onNeedAuth("Log in to open guest-box nights")) e.preventDefault();
          }}
        >
          Guest-box nights
        </Link>
        <Link href={appHref("/teams")} className="home-quiet-link" style={{ alignSelf: "center" }}>
          Full Teams desk
        </Link>
      </div>
    </section>
  );
}

function AdminGlass({
  demo,
  staff,
  staffError,
  idToken,
  onNeedAuth,
}: {
  demo: boolean;
  staff: AdminStaffMe | null;
  staffError: string | null;
  idToken: string | null;
  onNeedAuth: (reason: string) => boolean;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<AdminUserRow[]>([]);
  const [picked, setPicked] = useState<AdminUserRow | null>(null);
  const [coins, setCoins] = useState("100");
  const [reason, setReason] = useState("");
  const [postId, setPostId] = useState("");
  const [reports, setReports] = useState<AdminReportRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const live = !!idToken && !!staff;
  const canCredit = staffCan(staff, "economy.credit");
  const canBan = staffCan(staff, "users.ban");
  const canModerate = staffCan(staff, "content.moderate");

  const run = async (fn: () => Promise<void>) => {
    if (!live) {
      onNeedAuth("Log in with an allowlisted staff account");
      return;
    }
    setBusy(true);
    setErr(null);
    setNote(null);
    try {
      await fn();
    } catch (e) {
      setErr(
        e instanceof AdminStaffError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Admin action failed",
      );
    } finally {
      setBusy(false);
    }
  };

  const onSearch = () =>
    void run(async () => {
      if (!idToken) return;
      const items = await searchAdminUsers(idToken, q);
      setHits(items);
      setPicked(items[0] || null);
      setNote(items.length ? `Found ${items.length}` : "No accounts matched");
    });

  useEffect(() => {
    if (!live || !idToken) return;
    let alive = true;
    listOpenAdminReports(idToken)
      .then((out) => {
        if (alive) setReports(out.reports);
      })
      .catch(() => {
        if (alive) setReports([]);
      });
    return () => {
      alive = false;
    };
  }, [live, idToken]);

  return (
    <details className="cc-staff">
      <summary className="cc-staff-summary">
        Staff tools{staff?.roleDisplay ? ` · ${staff.roleDisplay}` : ""}
      </summary>
      <p className="cc-staff-lead">
        Same Cloud Run admin APIs as admin.blyp.world. Hidden from the public
        homepage chrome.
      </p>
      {staffError ? <p className="cc-staff-err">{staffError}</p> : null}
      {demo ? (
        <p className="cc-staff-lead">Demo chrome is off on this homepage.</p>
      ) : null}

      <label className="cc-staff-field">
        <span>Account lookup</span>
        <div className="cc-staff-row">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Username, email, or sub"
            className="cc-staff-input"
          />
          <button
            type="button"
            disabled={busy || !live}
            onClick={onSearch}
            className="cc-staff-btn"
          >
            Search
          </button>
        </div>
      </label>

      {hits.length ? (
        <ul className="cc-staff-hits">
          {hits.map((u) => (
            <li key={u.userId}>
              <button
                type="button"
                onClick={() => setPicked(u)}
                className={
                  picked?.userId === u.userId
                    ? "cc-staff-hit is-on"
                    : "cc-staff-hit"
                }
              >
                <span>
                  {u.displayName || u.username || u.userId.slice(0, 8)}
                </span>
                <em>
                  {u.isBanned ? "BANNED" : u.email || u.userId.slice(0, 12)}
                </em>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <label className="cc-staff-field">
        <span>Reason</span>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Required for credit / ban / remove"
          className="cc-staff-input"
        />
      </label>

      <div className="cc-staff-row">
        <input
          value={coins}
          onChange={(e) => setCoins(e.target.value)}
          inputMode="numeric"
          className="cc-staff-input cc-staff-coins"
          aria-label="Coins to credit"
        />
        <button
          type="button"
          disabled={busy || !live || !canCredit || !picked}
          onClick={() =>
            void run(async () => {
              if (!idToken || !picked) return;
              const n = Math.floor(Number(coins));
              if (!Number.isFinite(n) || n < 1) {
                throw new Error("Enter a coin amount");
              }
              if (!reason.trim()) throw new Error("Add a credit reason");
              if (
                !window.confirm(
                  `Credit ${n} bonus coins to ${picked.displayName || picked.userId}?`,
                )
              ) {
                return;
              }
              await creditAdminCoins(idToken, picked.userId, n, reason);
              setNote(`Credited ${n} coins`);
            })
          }
          className="cc-staff-btn cc-staff-btn-credit"
        >
          Credit coins
        </button>
        <button
          type="button"
          disabled={busy || !live || !canBan || !picked}
          onClick={() =>
            void run(async () => {
              if (!idToken || !picked) return;
              if (!reason.trim()) throw new Error("Add a ban reason");
              if (
                !window.confirm(
                  `Ban ${picked.displayName || picked.userId}? This hits the real admin API.`,
                )
              ) {
                return;
              }
              await banAdminUser(idToken, picked.userId, reason);
              setNote("User banned");
            })
          }
          className="cc-staff-btn cc-staff-btn-ban"
        >
          Ban user
        </button>
      </div>

      <div className="cc-staff-row">
        <input
          value={postId}
          onChange={(e) => setPostId(e.target.value)}
          placeholder="Post id"
          className="cc-staff-input"
        />
        <button
          type="button"
          disabled={busy || !live || !canModerate || !postId.trim()}
          onClick={() =>
            void run(async () => {
              if (!idToken) return;
              if (!reason.trim()) throw new Error("Add a remove reason");
              if (!window.confirm(`Remove post ${postId.trim()}?`)) return;
              await removeAdminPost(idToken, postId.trim(), reason);
              setNote("Post removed");
            })
          }
          className="cc-staff-btn"
        >
          Ban post
        </button>
      </div>

      <h3 className="cc-staff-h">Open complaints</h3>
      {!live ? (
        <p className="cc-staff-lead">
          Queue loads after an allowlisted staff session is verified.
        </p>
      ) : reports.length ? (
        <ul className="cc-staff-reports">
          {reports.map((r) => (
            <li key={r.reportId}>
              <span>{r.reasonCode || "report"}</span>
              <em>
                {r.targetType} {r.targetId.slice(0, 10)}
              </em>
            </li>
          ))}
        </ul>
      ) : (
        <p className="cc-staff-lead">No open reports.</p>
      )}

      {note ? <p className="cc-staff-note">{note}</p> : null}
      {err ? <p className="cc-staff-err">{err}</p> : null}
    </details>
  );
}
