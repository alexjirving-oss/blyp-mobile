#!/usr/bin/env python3
"""Fail-closed path lock helper for frozen product surfaces and control-plane paths.

NOTE: Do NOT wire this as preToolUse in hooks.json unless proven safe (prior
preToolUse wedged Cursor). Always-apply .mdc rules are the primary lock;
this script is the durable path list for optional/manual gates and docs.
"""
from __future__ import annotations

import json
import os
import sys

EDIT_TOOLS = {
    "write",
    "strreplace",
    "search_replace",
    "applypatch",
    "editnotebook",
    "delete",
}

# Product lock — For You frozen at 1.0.86 / 2026320003.
# Override only with Alex's explicit "unlock For You" + BLYP_ALLOW_INSTANT_FOR_YOU=1.
INSTANT_FOR_YOU_PREFIXES = (
    "src/feed/",
    "src/feed",
    "src/components/Feed/",
    "src/components/Feed",
    "src/services/feedAudioSession.js",
    "android/app/src/main/java/com/blyp/mobile/shorts/",
    "android/app/src/main/java/com/blyp/mobile/shorts",
    "plugins/blyp-shorts-ios/",
    "plugins/blyp-shorts-ios",
    "__tests__/forYouGroundUp.test.js",
    "__tests__/forYouPlayerController.test.js",
    "__tests__/forYouVideoLadder.test.js",
    "__tests__/forYouFeedFilter.test.js",
    "__tests__/forYouFeedList.test.js",
    "__tests__/forYouGroundUpPath.test.js",
    "__tests__/feedAudioSession.test.js",
)

# Coin / IAP monetization freeze — unlock IAP / unlock monetization + BLYP_ALLOW_IAP=1.
IAP_MONETIZATION_PREFIXES = (
    "src/services/BlypCoinService.js",
    "src/screens/CoinStoreScreen.js",
    "src/services/AndroidPlayBillingService.ts",
    "src/services/AndroidPlayBillingService.js",
    "src/components/BuyCoinsOverlay.tsx",
    "src/components/BlypCoinWallet.js",
    "src/utils/recoverPendingAndroidIap.js",
    "src/services/BillingVerificationService.js",
    "backend/blyp-live-service/src/economy/iapCatalog.ts",
    "tools/release/SYNC_PLAY_IAP_TITLES.md",
    ".cursor/rules/iap-monetization-freeze.mdc",
)

# LIVE streaming freeze — unlock LIVE + BLYP_ALLOW_LIVE=1.
LIVE_STREAMING_PREFIXES = (
    "src/live/",
    "src/live",
    "src/streaming/",
    "src/streaming",
    "src/screens/LiveStreamScreen.js",
    "src/screens/LiveSummaryScreen.js",
    "src/screens/live/",
    "src/screens/live",
    "src/components/live/",
    "src/components/live",
    "src/components/LiveStreamViewer.js",
    "src/components/LiveErrorBoundary.js",
    "src/components/LiveUsersTab.js",
    "src/services/LiveStreamService.js",
    "src/services/LiveService.js",
    "src/services/HLSLiveStreamService.js",
    "src/services/liveApiBase.js",
    "src/services/liveDirectory.js",
    "src/services/liveDashboardService.js",
    "src/services/livePublishAudioGuard.js",
    "src/api/ivsLiveApi.ts",
    "src/core/LiveSessionStore.ts",
    "src/core/LiveSessionModel.ts",
    "src/core/LiveGiftService.ts",
    "src/core/LiveEarningsHook.ts",
    "src/core/LiveStartNotificationHelper.ts",
    "src/config/liveStreamModel.ts",
    "src/config/LiveGamesFlags.js",
    "src/config/LiveDashboardFlags.js",
    "src/realtime/liveGiftSocket.ts",
    ".cursor/rules/live-freeze.mdc",
)

# Control plane — agents must not casually rewrite enforcement. Override via
# BLYP_ALLOW_CONTROL_PLANE=1 only when Alex authorized hook/accountability work.
CONTROL_PLANE_PREFIXES = (
    ".cursor/hooks.json",
    ".cursor/hooks/",
    ".accountability/",
    "tools/accountability/",
    ".github/workflows/accountability.yml",
)


def _normalize(path: str) -> str:
    value = path.strip().replace("\\", "/")
    while value.startswith("./"):
        value = value[2:]
    return value


def _paths_from_input(inp: dict) -> list[str]:
    paths: list[str] = []
    for key in ("path", "file_path", "target_notebook", "notebook_path"):
        value = inp.get(key)
        if isinstance(value, str) and value.strip():
            paths.append(_normalize(value))
    return paths


def _matches(path: str, prefixes: tuple[str, ...]) -> bool:
    lowered = path.lower()
    for prefix in prefixes:
        candidate = prefix.lower().rstrip("/")
        if lowered == candidate or lowered.startswith(candidate + "/"):
            return True
        # Exact file prefixes like .cursor/hooks.json
        if not prefix.endswith("/") and lowered == prefix.lower():
            return True
    return False


def deny(message: str) -> int:
    print(
        json.dumps(
            {
                "permission": "deny",
                "user_message": message,
                "agent_message": f"ACCOUNTABILITY PATH LOCK: {message}",
            }
        )
    )
    return 2


def main() -> int:
    try:
        data = json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError:
        return deny("preToolUse input was not valid JSON")

    tool = (data.get("tool_name") or data.get("toolName") or "").lower()
    if tool not in EDIT_TOOLS:
        print(json.dumps({"permission": "allow"}))
        return 0

    inp = data.get("tool_input") or data.get("arguments") or data.get("input") or {}
    if not isinstance(inp, dict):
        return deny("edit tool input must be an object")

    paths = _paths_from_input(inp)
    if not paths:
        print(json.dumps({"permission": "allow"}))
        return 0

    allow_foryou = os.environ.get("BLYP_ALLOW_INSTANT_FOR_YOU") == "1"
    allow_iap = os.environ.get("BLYP_ALLOW_IAP") == "1"
    allow_live = os.environ.get("BLYP_ALLOW_LIVE") == "1"
    allow_control = os.environ.get("BLYP_ALLOW_CONTROL_PLANE") == "1"

    for path in paths:
        if not allow_foryou and _matches(path, INSTANT_FOR_YOU_PREFIXES):
            return deny(
                "For You is frozen at 1.0.86. Do not edit feed/shorts/For You paths unless "
                "Alex explicitly says unlock For You (BLYP_ALLOW_INSTANT_FOR_YOU=1)."
            )
        if not allow_iap and _matches(path, IAP_MONETIZATION_PREFIXES):
            return deny(
                "IAP/coin monetization is frozen. Do not edit coin store / Play billing / "
                "iapCatalog paths unless Alex says unlock IAP or unlock monetization "
                "(BLYP_ALLOW_IAP=1)."
            )
        if not allow_live and _matches(path, LIVE_STREAMING_PREFIXES):
            return deny(
                "LIVE streaming is frozen. Do not edit live/streaming paths unless "
                "Alex explicitly says unlock LIVE (BLYP_ALLOW_LIVE=1)."
            )
        if not allow_control and _matches(path, CONTROL_PLANE_PREFIXES):
            return deny(
                "Accountability/control-plane paths are locked. Do not edit "
                ".cursor/hooks*, tools/accountability/**, or accountability workflows "
                "without Alex authorizing control-plane work (BLYP_ALLOW_CONTROL_PLANE=1)."
            )

    print(json.dumps({"permission": "allow"}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
