"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Rolling display for jackpot increments (CSS-free rAF tween).
 * Isolated so jackpot ticks do not remount the whole stage.
 */
export function RollingNumber({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  const [display, setDisplay] = useState(value);
  const displayRef = useRef(value);
  const fromRef = useRef(value);
  const toRef = useRef(value);
  const startRef = useRef(0);
  const rafRef = useRef(0);

  useEffect(() => {
    fromRef.current = displayRef.current;
    toRef.current = value;
    startRef.current = performance.now();

    const tick = (now: number) => {
      const t = Math.min(1, (now - startRef.current) / 450);
      const eased = 1 - (1 - t) * (1 - t);
      const next = Math.round(
        fromRef.current + (toRef.current - fromRef.current) * eased,
      );
      displayRef.current = next;
      setDisplay(next);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };

    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value]);

  return (
    <span className={className} data-rolling={value}>
      {display}
    </span>
  );
}
