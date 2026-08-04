#!/usr/bin/env python3
"""Inject session context before each user prompt reaches the agent."""
import json
import sys

import os

sys.path.insert(0, os.path.dirname(__file__))
from lib.session import failure_streaks, gate_failed, gate_status_line, load_session  # noqa: E402

MAX_FILE_EDITS = 6


def main() -> int:
    try:
        data = json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError:
        print("{}")
        return 0

    prompt = (data.get("prompt") or data.get("text") or "").strip()
    lines: list[str] = []

    if gate_failed():
        lines.append(
            "VERIFY GATE FAILED last stop. Fix typecheck/lint errors before new feature work. "
            "Run: npm run verify:session"
        )

    streaks = failure_streaks(2)
    if streaks:
        lines.append(
            "LOOP ALERT: repeated shell failures this session — do not retry blindly; report and stop."
        )

    s = load_session()
    hot = [
        (p, int(c))
        for p, c in (s.get("file_edits") or {}).items()
        if int(c) >= MAX_FILE_EDITS
    ]
    if hot:
        lines.append(
            "CHURN ALERT: high edit count on "
            + ", ".join(f"{p} ({c}x)" for p, c in hot[:5])
            + " — verify before more edits."
        )

    if not lines and not prompt:
        print("{}")
        return 0

    ctx = "[verified-forward session] " + gate_status_line()
    if lines:
        ctx += "\n" + "\n".join(lines)

    print(json.dumps({"additional_context": ctx}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
