"use client";

import { io, type Socket } from "socket.io-client";
import { liveServiceUrl } from "@/lib/env";
import {
  GRID9_PROTOCOL,
  GRID9_PROTOCOL_VERSION,
  GRID9_SOCKET_CHANNEL,
} from "./PROTOCOL_MAP";

export type StudioGrid9WireEvent = {
  type?: string;
  protocol?: string;
  connectionSessionId?: string;
  matchId?: string | null;
  stateVersion?: number;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
};

function randomId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `g9-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Base64url nonce with ≥128 bits entropy (Grid 9 wire requirement). */
export function createStudioGrid9Nonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = "";
  bytes.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function createStudioGrid9Socket(getIdToken: () => Promise<string>): Socket {
  return io(liveServiceUrl, {
    autoConnect: false,
    transports: ["websocket"],
    reconnection: true,
    auth: (cb: (data: { token: string } | Error) => void) => {
      getIdToken()
        .then((token) => cb({ token }))
        .catch((err: unknown) =>
          cb(err instanceof Error ? err : new Error("Grid 9 auth failed")),
        );
    },
  });
}

export function emitStudioGrid9Intent(
  socket: Socket,
  intent: Record<string, unknown>,
): void {
  socket.emit(GRID9_SOCKET_CHANNEL, intent);
}

export function subscribeStudioGrid9Channel(
  socket: Socket,
  onEvent: (event: StudioGrid9WireEvent) => void,
): () => void {
  const handler = (raw: unknown) => {
    if (raw && typeof raw === "object") {
      onEvent(raw as StudioGrid9WireEvent);
    }
  };
  socket.on(GRID9_SOCKET_CHANNEL, handler);
  return () => {
    socket.off(GRID9_SOCKET_CHANNEL, handler);
  };
}

export function buildStudioIntent(args: {
  connectionSessionId: string;
  type: string;
  matchId: string | null;
  expectedStateVersion: number | null;
  payload: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    protocol: GRID9_PROTOCOL,
    protocolVersion: GRID9_PROTOCOL_VERSION,
    direction: "client_to_server",
    connectionSessionId: args.connectionSessionId,
    messageId: randomId(),
    intentId: randomId(),
    nonce: createStudioGrid9Nonce(),
    sentAt: new Date().toISOString(),
    type: args.type,
    matchId: args.matchId,
    expectedStateVersion: args.expectedStateVersion,
    payload: args.payload,
  };
}
