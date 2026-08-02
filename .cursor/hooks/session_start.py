#!/usr/bin/env python3
"""Create a fresh, strict accountability session."""
from __future__ import annotations

import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(__file__))
from lib.session import SessionError, create_session  # noqa: E402


def main() -> int:
    try:
        session = create_session()
    except (OSError, SessionError, subprocess.SubprocessError) as error:
        print(f"ACCOUNTABILITY SESSION START BLOCKED: {error}", file=sys.stderr)
        return 2
    _ = session
    print(json.dumps({}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
