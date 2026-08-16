import Link from "next/link";
import type { FeedPost } from "@/lib/feed";
import type { StageModel } from "@/lib/stage";

export function StageView({
  stage,
  pinned,
}: {
  stage: StageModel;
  pinned: FeedPost[];
}) {
  const c = stage.theme.colors;
  const cover = stage.coverUrl
    ? `url(${stage.coverUrl})`
    : `linear-gradient(135deg, ${c.coverFallback[0]}, ${c.coverFallback[1]})`;

  return (
    <div
      className="min-h-[calc(100vh-4rem)]"
      style={{ background: c.bg, color: c.text }}
    >
      <div
        className="relative h-52 w-full bg-cover bg-center md:h-72"
        style={{ backgroundImage: cover }}
      >
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to top, rgba(0,0,0,0.75), transparent 55%)",
          }}
        />
        {stage.liveStreamId ? (
          <Link
            href={`/live/${stage.liveStreamId}`}
            className="absolute right-5 top-5 rounded-full px-4 py-2 text-xs font-bold uppercase tracking-[0.18em]"
            style={{ background: c.accent, color: "#07070a" }}
          >
            LIVE now
          </Link>
        ) : null}
      </div>

      <div className="mx-auto max-w-[900px] px-5 pb-16">
        <div className="-mt-12 flex items-end gap-4">
          <div
            className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border-4 text-3xl font-bold"
            style={{ borderColor: c.bg, background: c.surface }}
          >
            {stage.photoURL ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={stage.photoURL}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              stage.displayName.slice(0, 1).toUpperCase()
            )}
          </div>
          <div className="pb-2">
            <h1 className="font-display text-3xl font-extrabold md:text-4xl">
              {stage.displayName}
              {stage.verified ? (
                <span className="ml-2 text-base" style={{ color: c.accent }}>
                  ✓
                </span>
              ) : null}
            </h1>
            <p className="text-sm" style={{ color: c.textMuted }}>
              @{stage.username}
            </p>
          </div>
        </div>

        {stage.vibe ? (
          <p
            className="mt-4 inline-block rounded-full px-3 py-1 text-xs font-semibold"
            style={{ background: c.accentSoft, color: c.accent }}
          >
            {stage.vibe}
          </p>
        ) : null}

        {stage.bio ? (
          <p className="mt-5 max-w-xl text-base leading-relaxed opacity-90">
            {stage.bio}
          </p>
        ) : null}

        {stage.links.length ? (
          <div className="mt-8 flex flex-wrap gap-2">
            {stage.links.map((l) => (
              <a
                key={l.id}
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full border px-4 py-2 text-sm font-semibold"
                style={{ borderColor: c.border }}
              >
                {l.label}
              </a>
            ))}
          </div>
        ) : null}

        {pinned.length ? (
          <section className="mt-12">
            <h2 className="font-display text-xl font-bold">Pinned</h2>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {pinned.map((p) => (
                <Link
                  key={p.id}
                  href={`/v/${p.id}`}
                  className="aspect-[9/16] overflow-hidden rounded-lg"
                  style={{ background: c.surface }}
                >
                  {p.posterUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.posterUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs opacity-60">
                      Watch
                    </div>
                  )}
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        <div className="mt-12">
          <Link
            href="/foryou"
            className="rounded-full px-5 py-2.5 text-sm font-semibold"
            style={{ background: c.accent, color: "#07070a" }}
          >
            Watch For You
          </Link>
        </div>
      </div>
    </div>
  );
}
