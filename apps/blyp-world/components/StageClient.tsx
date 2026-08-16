"use client";

import { useEffect, useState } from "react";
import { StageView } from "./StageView";
import { fetchStageByUsername, type StageModel } from "@/lib/stage";
import type { FeedPost } from "@/lib/feed";

export function StageClient({ username }: { username: string }) {
  const [state, setState] = useState<{
    stage: StageModel;
    pinned: FeedPost[];
  } | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const result = await fetchStageByUsername(username);
      if (!alive) return;
      if (!result) setMissing(true);
      else setState(result);
    })();
    return () => {
      alive = false;
    };
  }, [username]);

  if (missing) {
    return (
      <div className="mx-auto max-w-lg px-5 py-20 text-center">
        <p className="font-display text-3xl font-bold">@{username}</p>
        <p className="mt-3 text-sm text-[var(--blyp-muted)]">
          No Stage found for this username yet.
        </p>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="mx-auto max-w-lg px-5 py-20 text-center text-sm text-[var(--blyp-muted)]">
        Loading Stage…
      </div>
    );
  }

  return <StageView stage={state.stage} pinned={state.pinned} />;
}
