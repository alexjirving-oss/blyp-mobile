"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { enterLiveStudio } from "@/lib/enterLiveStudio";
import "./studio-launch-button.css";

function LaunchMark({ broadcast }: { broadcast: boolean }) {
  if (!broadcast) {
    return <span className="blyp-studio-launch-dot" aria-hidden />;
  }
  return (
    <svg
      className="blyp-studio-launch-wave"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden
    >
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        d="M3.2 7.2a7 7 0 0 1 9.6 0"
      />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        d="M5.2 9.35a4 4 0 0 1 5.6 0"
      />
      <circle cx="8" cy="12.15" r="1.25" fill="currentColor" />
    </svg>
  );
}

export function StudioLaunchButton({
  compact = false,
  label = "Live Studio",
  className = "",
}: {
  compact?: boolean;
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const broadcast =
    !compact &&
    (className.includes("blyp-studio-launch-lg") ||
      /go live|open live/i.test(label));

  return (
    <Link
      href="/live/studio"
      className={`blyp-studio-launch${compact ? " blyp-studio-launch-compact" : ""}${className ? ` ${className}` : ""}`}
      onClick={(event) => {
        if (
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          event.button !== 0
        ) {
          return;
        }
        event.preventDefault();
        void enterLiveStudio((href) => router.push(href));
      }}
    >
      <LaunchMark broadcast={broadcast} />
      {label}
    </Link>
  );
}
