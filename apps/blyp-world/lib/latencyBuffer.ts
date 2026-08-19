"use client";

import { useEffect, useRef, useState } from "react";

export function useLatencyBuffered<T>(value: T, delayMs: number): T {
  const [shown, setShown] = useState<T>(value);
  const queueRef = useRef<Array<{ at: number; value: T }>>([]);
  const initialRef = useRef(value);
  const lastJson = useRef<string>(JSON.stringify(value));

  useEffect(() => {
    const json = JSON.stringify(value);
    if (json !== lastJson.current) {
      lastJson.current = json;
      queueRef.current.push({ at: Date.now(), value });
      if (queueRef.current.length > 20) queueRef.current.shift();
    }
    const tick = () => {
      const now = Date.now();
      const due = queueRef.current.filter((e) => e.at + delayMs <= now);
      if (due.length) {
        setShown(due[due.length - 1].value);
      } else if (!queueRef.current.length) {
        setShown(initialRef.current);
      }
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [value, delayMs]);

  return shown;
}
