#!/usr/bin/env python3
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from lib.session import add_files  # noqa: E402


def extract_paths(data: dict) -> list[str]:
    paths: list[str] = []
    for key in ("file_path", "path", "filePath", "file"):
        v = data.get(key)
        if isinstance(v, str) and v.strip():
            paths.append(v)
    for item in data.get("edits") or data.get("files") or []:
        if isinstance(item, str):
            paths.append(item)
        elif isinstance(item, dict):
            for key in ("file_path", "path", "file"):
                v = item.get(key)
                if isinstance(v, str):
                    paths.append(v)
    return paths


def main() -> int:
    try:
        data = json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError:
        print("{}")
        return 0
    add_files(extract_paths(data))
    print("{}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
