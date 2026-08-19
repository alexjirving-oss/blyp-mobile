"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { runSearch, type SearchResults } from "@/lib/search";
import "./search-page.css";

type Tab = "all" | "people" | "videos" | "teams";

const EMPTY: SearchResults = { users: [], posts: [], teams: [] };

function formatCount(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function syncQueryParam(term: string) {
  try {
    const url = new URL(window.location.href);
    if (term) url.searchParams.set("q", term);
    else url.searchParams.delete("q");
    const next = `${url.pathname}${url.search}${url.hash}`;
    const now = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next !== now) window.history.replaceState({}, "", next);
  } catch {
    /* ignore */
  }
}

function SearchIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" strokeLinecap="round" />
    </svg>
  );
}

export function SearchClient() {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("all");

  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search).get("q");
      if (q) setQuery(q);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query.trim()), 280);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    syncQueryParam(debounced);
  }, [debounced]);

  useEffect(() => {
    if (debounced.length < 2) {
      setResults(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const next = await runSearch(debounced);
        if (!cancelled) setResults(next);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Search failed");
          setResults(EMPTY);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  const submit = useCallback((e: FormEvent) => {
    e.preventDefault();
    setDebounced(query.trim());
  }, [query]);

  const counts = useMemo(() => {
    const users = results?.users.length || 0;
    const posts = results?.posts.length || 0;
    const teams = results?.teams.length || 0;
    return { users, posts, teams, all: users + posts + teams };
  }, [results]);

  const showPeople = tab === "all" || tab === "people";
  const showVideos = tab === "all" || tab === "videos";
  const showTeams = tab === "all" || tab === "teams";
  const idle = debounced.length === 0;
  const tooShort = debounced.length > 0 && debounced.length < 2;
  const empty =
    !!results &&
    !loading &&
    ((tab === "all" && counts.all === 0) ||
      (tab === "people" && counts.users === 0) ||
      (tab === "videos" && counts.posts === 0) ||
      (tab === "teams" && counts.teams === 0));

  return (
    <div className="search-page">
      <div className="search-page-inner">
        <header className="search-hero">
          <p className="search-kicker">Discover</p>
          <h1>Search</h1>
          <p className="search-hero-copy">
            People, videos, and teams — live Firestore, same as the app.
          </p>
          <form className="search-field" onSubmit={submit} role="search">
            <SearchIcon />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              placeholder="Search blyp"
              aria-label="Search people, videos, and teams"
            />
          </form>
          {error ? (
            <p className="search-status is-error">{error}</p>
          ) : loading ? (
            <p className="search-status">Searching live results…</p>
          ) : tooShort ? (
            <p className="search-status">Type at least 2 characters.</p>
          ) : null}
        </header>

        {results && !idle && !tooShort ? (
          <div className="search-tabs" role="tablist" aria-label="Result type">
            {(
              [
                ["all", "All", counts.all],
                ["people", "People", counts.users],
                ["videos", "Videos", counts.posts],
                ["teams", "Teams", counts.teams],
              ] as const
            ).map(([id, label, n]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={`search-tab${tab === id ? " is-on" : ""}`}
                onClick={() => setTab(id)}
              >
                {label}
                <span className="search-tab-n">{n}</span>
              </button>
            ))}
          </div>
        ) : null}

        {loading ? (
          <section className="search-card" aria-hidden>
            <div className="search-pulse" style={{ width: "28%", marginBottom: 14 }} />
            <div className="search-pulse" style={{ width: "72%", marginBottom: 10 }} />
            <div className="search-pulse" style={{ width: "54%" }} />
          </section>
        ) : null}

        {idle && !loading ? (
          <section className="search-card">
            <div className="search-idle">
              <div className="search-idle-mark">
                <SearchIcon />
              </div>
              <div className="search-empty">
                <strong>Type to search</strong>
                <p>At least 2 characters. Matches come from live users, posts, and teams.</p>
              </div>
            </div>
          </section>
        ) : null}

        {!loading && empty ? (
          <section className="search-card">
            <div className="search-empty">
              <strong>No matches</strong>
              <p>
                Nothing in live data for “{debounced}”
                {tab !== "all" ? ` in ${tab}` : ""}.
              </p>
            </div>
          </section>
        ) : null}

        {results && !loading ? (
          <>
            {showPeople && results.users.length ? (
              <section className="search-card">
                <div className="search-card-head">
                  <h2>People</h2>
                  <span>{results.users.length}</span>
                </div>
                <ul className="search-people">
                  {results.users.map((u) => (
                    <li key={u.id}>
                      <Link
                        href={`/u/${encodeURIComponent(u.username)}`}
                        className="search-row"
                      >
                        {u.photoURL ? (
                          <span className="search-avatar">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={u.photoURL} alt="" />
                          </span>
                        ) : (
                          <span className="search-avatar">
                            {(u.username || "U").slice(0, 1).toUpperCase()}
                          </span>
                        )}
                        <span className="search-row-copy">
                          <p className="search-row-title">{u.displayName}</p>
                          <p className="search-row-meta">@{u.username}</p>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {showVideos && results.posts.length ? (
              <section className="search-card">
                <div className="search-card-head">
                  <h2>Videos</h2>
                  <span>{results.posts.length}</span>
                </div>
                <div className="search-clips">
                  {results.posts.map((p) => (
                    <Link
                      key={p.id}
                      href={`/v/${encodeURIComponent(p.id)}`}
                      className="search-clip"
                    >
                      {p.posterUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.posterUrl} alt="" />
                      ) : (
                        <div className="search-clip-fallback">
                          {p.caption.slice(0, 80) || `@${p.username}`}
                        </div>
                      )}
                      <div className="search-clip-meta">
                        <p>@{p.username}</p>
                        <span>♥ {formatCount(p.likes)}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            ) : null}

            {showTeams && results.teams.length ? (
              <section className="search-card">
                <div className="search-card-head">
                  <h2>Teams</h2>
                  <span>{results.teams.length}</span>
                </div>
                <ul className="search-teams">
                  {results.teams.map((t) => (
                    <li key={t.id}>
                      <Link href="/teams" className="search-row">
                        <span className="search-avatar">
                          {t.name.slice(0, 1).toUpperCase()}
                        </span>
                        <span className="search-row-copy">
                          <p className="search-row-title">{t.name}</p>
                          <p className="search-row-meta">
                            {t.leaderName}
                            {t.memberCount ? ` · ${t.memberCount} members` : ""}
                          </p>
                        </span>
                        <span className="search-row-go">Open</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
