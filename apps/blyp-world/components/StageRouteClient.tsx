"use client";

import { useEffect, useState } from "react";
import { StageClient } from "./StageClient";
import "./stage-profile.css";

export function StageRouteClient() {
  const [username, setUsername] = useState<string | null>(null);
  useEffect(() => {
    const seg = window.location.pathname.split("/").filter(Boolean);
    const raw = seg[0] === "u" ? seg[1] : null;
    setUsername(raw && raw !== "_" ? decodeURIComponent(raw) : null);
  }, []);
  if (!username) {
    return (
      <div className="stage-web">
        <div className="stage-web-state">
          <div className="stage-web-pulse" aria-hidden />
          <p className="stage-web-copy">Loading Stage…</p>
        </div>
      </div>
    );
  }
  return <StageClient username={username} />;
}
