#!/usr/bin/env python3
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from lib.session import reset_session  # noqa: E402


def main() -> int:
    reset_session()
    print("{}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
