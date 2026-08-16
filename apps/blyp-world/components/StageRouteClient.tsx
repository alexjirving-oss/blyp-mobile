"use client";

import { useEffect, useState } from "react";
import { StageClient } from "./StageClient";

export function StageRouteClient() {
  const [username, setUsername] = useState<string | null>(null);
  useEffect(() => {
    const seg = window.location.pathname.split("/").filter(Boolean);
    const raw = seg[0] === "u" ? seg[1] : null;
    setUsername(raw && raw !== "_" ? decodeURIComponent(raw) : null);
  }, []);
  if (!username) {
    return (
      <div className="mx-auto max-w-lg px-5 py-20 text-center text-sm text-[var(--blyp-muted)]">
        Loading Stage…
      </div>
    );
  }
  return <StageClient username={username} />;
}
