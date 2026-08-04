#!/usr/bin/env python3
"""Record shell failures for loop detection on stop."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from lib.session import record_shell  # noqa: E402


def main() -> int:
    try:
        data = json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError:
        print("{}")
        return 0

    command = data.get("command") or data.get("cmd") or ""
    exit_code = data.get("exit_code")
    if exit_code is None:
        exit_code = data.get("exitCode")
    output = (data.get("output") or data.get("stderr") or data.get("stdout") or "")[:500]

    ok = exit_code in (0, None) and "error" not in output.lower()[:120]
    if exit_code is not None:
        ok = exit_code == 0

    if command:
        record_shell(command, ok=ok, exit_code=exit_code)

    print("{}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
