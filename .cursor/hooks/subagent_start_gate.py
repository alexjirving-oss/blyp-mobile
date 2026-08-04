#!/usr/bin/env python3
"""Block write-capable subagents on forensic paths unless user allows."""
import json
import os
import sys

FORENSIC_MARKERS = ("forensic/", "constraint_probe", "gemini.google.com", "api_audit")


def main() -> int:
    try:
        data = json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError:
        print(json.dumps({"permission": "allow"}))
        return 0

    prompt = (data.get("prompt") or data.get("task") or "").lower()
    readonly = data.get("readonly")
    subagent = (data.get("subagent_type") or data.get("type") or "").lower()

    if any(m in prompt for m in FORENSIC_MARKERS) and subagent in ("generalpurpose", "explore", "shell"):
        if readonly is not True and not os.environ.get("BLYP_FORENSIC_SUBAGENT"):
            print(json.dumps({
                "permission": "deny",
                "user_message": "Forensic/browser work must use parent agent or readonly subagent.",
                "agent_message": "Subagent blocked for forensic lane.",
            }))
            return 2

    print(json.dumps({"permission": "allow"}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
