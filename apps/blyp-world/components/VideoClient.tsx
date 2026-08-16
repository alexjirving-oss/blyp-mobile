"use client";

import { useEffect, useState } from "react";
import { ForYouClient } from "./ForYouClient";

export function VideoClient() {
  const [id, setId] = useState<string | undefined>(undefined);
  useEffect(() => {
    const seg = window.location.pathname.split("/").filter(Boolean);
    const raw = seg[0] === "v" ? seg[1] : undefined;
    setId(raw && raw !== "_" ? decodeURIComponent(raw) : undefined);
  }, []);
  return <ForYouClient startId={id} />;
}
