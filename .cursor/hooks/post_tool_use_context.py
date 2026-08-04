#!/usr/bin/env python3
"""After Shell: inject loop warnings when commands fail."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from lib.session import cmd_hash, load_session  # noqa: E402


def main() -> int:
    try:
        data = json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError:
        print("{}")
        return 0

    tool = (data.get("tool_name") or data.get("toolName") or "").lower()
    if tool != "shell":
        print("{}")
        return 0

    result = data.get("result") or data.get("tool_output") or {}
    if not isinstance(result, dict):
        print("{}")
        return 0

    exit_code = result.get("exit_code")
    if exit_code is None:
        exit_code = result.get("exitCode")
    if exit_code in (0, None):
        print("{}")
        return 0

    inp = data.get("tool_input") or data.get("arguments") or {}
    command = ""
    if isinstance(inp, dict):
        command = inp.get("command") or ""

    s = load_session()
    fails = s.get("shell_failures") or {}
    entry = fails.get(cmd_hash(command)) if command else None
    count = int(entry.get("count") or 0) if entry else 0

    msg = (
        f"Shell exited {exit_code}. Read output before retrying. "
        f"Same command failed {count}x this session."
    )
    if count >= 2:
        msg += " STOP: loop detector — change approach or ask user."

    print(json.dumps({"additional_context": msg}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
