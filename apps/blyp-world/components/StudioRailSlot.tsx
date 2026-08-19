"use client";

import type { ReactNode } from "react";

export function StudioRailSlot(props: {
  title: string;
  order: number;
  canUp: boolean;
  canDown: boolean;
  onUp: () => void;
  onDown: () => void;
  children: ReactNode;
}) {
  const { title, order, canUp, canDown, onUp, onDown, children } = props;
  return (
    <div className="tls-rail-slot" style={{ order }}>
      <div className="tls-rail-slot-bar">
        <span className="tls-rail-slot-title">{title}</span>
        <span className="tls-rail-slot-moves">
          <button
            type="button"
            className="tls-rail-slot-move"
            aria-label={`Move ${title} up`}
            disabled={!canUp}
            onClick={onUp}
          >
            ▲
          </button>
          <button
            type="button"
            className="tls-rail-slot-move"
            aria-label={`Move ${title} down`}
            disabled={!canDown}
            onClick={onDown}
          >
            ▼
          </button>
        </span>
      </div>
      {children}
    </div>
  );
}
