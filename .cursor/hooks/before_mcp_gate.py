#!/usr/bin/env python3
"""Gate MCP: throttle browser/API hammering in a session."""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from lib.session import bump_counter, get_counter, load_session  # noqa: E402

BROWSER_TOOLS = re.compile(
    r"browser_(click|navigate|type|fill|snapshot|cdp|tabs)",
    re.I,
)


def main() -> int:
    try:
        data = json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError:
        print(json.dumps({"permission": "allow"}))
        return 0

    tool = data.get("tool_name") or data.get("toolName") or data.get("name") or ""
    args = data.get("arguments") or data.get("tool_input") or {}
    args_str = json.dumps(args) if isinstance(args, dict) else str(args)

    if BROWSER_TOOLS.search(tool):
        n = bump_counter("mcp_browser_calls")
        if n > 60:
            print(json.dumps({
                "permission": "deny",
                "user_message": f"Browser automation cap hit ({n} calls this session). Stop and report.",
                "agent_message": "MCP browser cap — anti-loop protection.",
            }))
            return 2
        if n > 35:
            print(json.dumps({
                "permission": "ask",
                "user_message": f"Heavy browser automation ({n} calls). Continue?",
                "agent_message": "Browser call budget high.",
            }))
            return 0

    if "gemini" in args_str.lower() and "generativelanguage" in args_str.lower():
        bump_counter("api_http_calls")

    s = load_session()
    if int(s.get("api_http_calls") or 0) > 25:
        print(json.dumps({
            "permission": "deny",
            "user_message": "API call budget exhausted this session.",
            "agent_message": "API quota protection.",
        }))
        return 2

    print(json.dumps({"permission": "allow"}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
