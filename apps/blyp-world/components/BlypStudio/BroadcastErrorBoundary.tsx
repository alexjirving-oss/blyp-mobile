"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  onFatal?: (error: Error) => void;
};

type State = { hasError: boolean; message: string };

/**
 * Isolates BroadcastComposite / capture UI failures so the director shell stays up.
 * onFatal should flip capture canvas to STAND BY slate.
 */
export class BroadcastErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: "" };

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error?.message || "Broadcast composite failed",
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[BlypStudio] BroadcastErrorBoundary", error, info.componentStack);
    this.props.onFatal?.(error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="blyp-studio-standby-ui" role="alert">
          <div className="blyp-studio-standby-title">PLEASE STAND BY</div>
          <div className="blyp-studio-standby-sub">SIGNAL LOST</div>
          <div className="blyp-studio-standby-msg">{this.state.message}</div>
        </div>
      );
    }
    return this.props.children;
  }
}
