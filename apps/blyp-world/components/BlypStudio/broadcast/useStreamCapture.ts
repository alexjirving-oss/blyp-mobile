"use client";

import {
  useEffect,
  useRef,
  type MutableRefObject,
  type RefObject,
} from "react";
import type { ActiveMode, GridSlot } from "../store/StudioStateContext";

export type StreamCaptureHandle = {
  getPublishStream: () => MediaStream | null;
};

type CaptureState = {
  activeMode: ActiveMode;
  gridSlots: GridSlot[];
  spotlightSlot: number;
  jackpotPool: number;
  topSupporters: string[];
  standBySignal: boolean;
  cameraFrozen: boolean;
};

/**
 * Overlay canvas is director-only. Never captureStream it onto Stage —
 * phones then stall / still-frame. Preview overlays stay in DOM.
 */
export function useStreamCapture(opts: {
  previewStream: MediaStream | null;
  state: CaptureState;
  cleanFeedStreamRef: MutableRefObject<MediaStream | null>;
}): {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  capture: StreamCaptureHandle;
} {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    opts.cleanFeedStreamRef.current = null;
    return () => {
      opts.cleanFeedStreamRef.current = null;
    };
  }, [opts.cleanFeedStreamRef]);

  const capture: StreamCaptureHandle = {
    getPublishStream: () => null,
  };

  return { canvasRef, capture };
}
