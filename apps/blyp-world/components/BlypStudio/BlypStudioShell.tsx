"use client";

import { useEffect } from "react";
import "./blyp-studio.css";
import { useDirectorHotkeys } from "./hooks/useDirectorHotkeys";
import { BottomConsole } from "./regions/BottomConsole";
import { CenterStage } from "./regions/CenterStage";
import { DirectorPanel } from "./regions/DirectorPanel";
import { SocialPanel } from "./regions/SocialPanel";
import { TopBar } from "./regions/TopBar";
import { useStudioGrid9Bridge } from "./socket/useStudioGrid9Bridge";
import { StudioStateProvider } from "./store/StudioStateContext";

function useStudioViewportLock() {
  useEffect(() => {
    const prevHtml = document.documentElement.style.overflow;
    const prevBody = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = prevHtml;
      document.body.style.overflow = prevBody;
    };
  }, []);
}

function StudioRuntime() {
  useStudioGrid9Bridge();
  useDirectorHotkeys();
  useStudioViewportLock();
  return (
    <div className="blyp-studio-root" data-blyp-studio="phase-5-socket-resilience">
      <TopBar />
      <DirectorPanel />
      <CenterStage />
      <SocialPanel />
      <BottomConsole />
    </div>
  );
}

/**
 * BlypStudio control room shell.
 * Phase 5: Grid 9 socket bridge (honest protocol map) + hotkeys + capture resilience.
 */
export function BlypStudioShell() {
  return (
    <StudioStateProvider>
      <StudioRuntime />
    </StudioStateProvider>
  );
}
