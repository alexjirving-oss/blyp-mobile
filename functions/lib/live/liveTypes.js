"use strict";
/**
 * Domain types for Amazon IVS Live Streaming.
 *
 * Architecture:
 * - LiveSession: Represents a live stream session (1 host, 0-11 guests, unlimited viewers)
 * - LiveSlot: Represents a guest participant slot within a session
 * - All state persisted to Firestore at: liveSessions/{sessionId}
 */
Object.defineProperty(exports, "__esModule", { value: true });
//# sourceMappingURL=liveTypes.js.map