"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { runSearch, type SearchResults } from "@/lib/search";

function formatCount(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

export function SearchClient() {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query.trim()), 280);
    return () => window.clearTimeout(t);
  }, [query]);

  const search = useCallback(async (term: string) => {
    if (term.length < 2) {
      setResults(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await runSearch(term);
      setResults(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
      setResults({ users: [], posts: [], teams: [] });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void search(debounced);
  }, [debounced, search]);

  const empty =
    results &&
    !results.users.length &&
    !results.posts.length &&
    !results.teams.length;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 pb-24 md:px-8">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--blyp-teal)]">
          Discover
        </p>
        <h1 className="font-display mt-1 text-3xl font-bold">Search</h1>
        <p className="mt-2 text-sm text-[var(--blyp-muted)]">
          People, videos, and teams — same Firestore data as the app.
        </p>
      </header>

      <form
        className="relative"
        onSubmit={(e) => {
          e.preventDefault();
          void search(query.trim());
        }}
      >
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          placeholder="Search @username, caption, team…"
          className="w-full rounded-2xl border border-[var(--blyp-line)] bg-[var(--blyp-ink-elevated)] px-5 py-3.5 text-[15px] text-[var(--blyp-fog)] outline-none ring-[var(--blyp-teal)] placeholder:text-[var(--blyp-muted)] focus:ring-2"
        />
      </form>

      {error ? (
        <p className="mt-6 text-sm text-[var(--blyp-rose)]">{error}</p>
      ) : null}

      {loading ? (
        <p className="mt-8 text-sm text-[var(--blyp-muted)]">Searching…</p>
      ) : null}

      {!loading && debounced.length > 0 && debounced.length < 2 ? (
        <p className="mt-8 text-sm text-[var(--blyp-muted)]">
          Type at least 2 characters.
        </p>
      ) : null}

      {!loading && empty ? (
        <p className="mt-8 text-sm text-[var(--blyp-muted)]">
          No matches for “{debounced}”.
        </p>
      ) : null}

      {results && !loading ? (
        <div className="mt-8 space-y-10">
          {results.users.length ? (
            <section>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--blyp-muted)]">
                People
              </h2>
              <ul className="divide-y divide-[var(--blyp-line)] rounded-2xl border border-[var(--blyp-line)] bg-[var(--blyp-ink-elevated)]">
                {results.users.map((u) => (
                  <li key={u.id}>
                    <Link
                      href={`/u/${encodeURIComponent(u.username)}`}
                      className="flex items-center gap-3 px-4 py-3 transition hover:bg-white/[0.03]"
                    >
                      {u.photoURL ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={u.photoURL}
                          alt=""
                          className="h-11 w-11 rounded-full object-cover"
                        />
                      ) : (
                        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--blyp-teal)] text-sm font-bold text-[var(--blyp-ink)]">
                          {(u.username || "U").slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="truncate font-semibold">
                          {u.displayName}
                        </p>
                        <p className="truncate text-sm text-[var(--blyp-muted)]">
                          @{u.username}
                        </p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {results.posts.length ? (
            <section>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--blyp-muted)]">
                Videos
              </h2>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {results.posts.map((p) => (
                  <Link
                    key={p.id}
                    href={`/v/${encodeURIComponent(p.id)}`}
                    className="group relative aspect-[9/16] overflow-hidden rounded-xl bg-black"
                  >
                    {p.posterUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.posterUrl}
                        alt=""
                        className="h-full w-full object-cover transition group-hover:scale-[1.03]"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center bg-gradient-to-b from-[#1a1a22] to-black p-3 text-center text-xs text-[var(--blyp-muted)]">
                        {p.caption.slice(0, 80) || `@${p.username}`}
                      </div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-2.5 pt-10">
                      <p className="truncate text-xs font-semibold text-white">
                        @{p.username}
                      </p>
                      <p className="mt-0.5 text-[11px] text-white/75">
                        ♥ {formatCount(p.likes)}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          {results.teams.length ? (
            <section>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--blyp-muted)]">
                Teams
              </h2>
              <ul className="divide-y divide-[var(--blyp-line)] rounded-2xl border border-[var(--blyp-line)] bg-[var(--blyp-ink-elevated)]">
                {results.teams.map((t) => (
                  <li key={t.id}>
                    <Link
                      href="/teams"
                      className="flex items-center justify-between gap-3 px-4 py-3 transition hover:bg-white/[0.03]"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{t.name}</p>
                        <p className="truncate text-sm text-[var(--blyp-muted)]">
                          {t.leaderName}
                          {t.memberCount
                            ? ` · ${t.memberCount} members`
                            : ""}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs font-semibold text-[var(--blyp-teal)]">
                        Open
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
