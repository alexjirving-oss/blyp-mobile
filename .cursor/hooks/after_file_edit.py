#!/usr/bin/env python3
"""Record every edited path; malformed hook input fails closed."""
from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from lib.session import SessionError, add_edited_files  # noqa: E402

PATH_KEYS = {"file_path", "filePath", "path", "file"}


def extract_paths(value: object) -> list[str]:
    paths: list[str] = []
    if isinstance(value, dict):
        for key, item in value.items():
            if key in PATH_KEYS and isinstance(item, str) and item.strip():
                paths.append(item)
            elif key in {"tool_input", "toolInput", "edits", "files", "changes"}:
                paths.extend(extract_paths(item))
    elif isinstance(value, list):
        for item in value:
            paths.extend(extract_paths(item))
    elif isinstance(value, str):
        paths.append(value)
    return paths


def main() -> int:
    try:
        raw = sys.stdin.read()
        payload = json.loads(raw)
        if not isinstance(payload, dict):
            raise SessionError("afterFileEdit input must be an object")
        add_edited_files(extract_paths(payload))
    except (json.JSONDecodeError, OSError, SessionError) as error:
        print(f"ACCOUNTABILITY EDIT TRACKING BLOCKED: {error}", file=sys.stderr)
        return 2
    print("{}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
