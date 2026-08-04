#!/usr/bin/env python3
"""Gate tools: background Task/Shell, bulk subagents, churn, failed gate."""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from lib.session import bump_counter, file_edit_count, gate_failed, load_session  # noqa: E402

EDIT_TOOLS = {"write", "strreplace", "search_replace", "applypatch", "editnotebook"}
MAX_FILE_EDITS = 6
MAX_SCOPE_FILES = 40


def _paths_from_input(inp: dict) -> list[str]:
    paths: list[str] = []
    for key in ("path", "file_path", "target_notebook", "notebook_path"):
        v = inp.get(key)
        if isinstance(v, str) and v.strip():
            paths.append(v.replace("\\", "/"))
    return paths


def deny(msg: str) -> int:
    print(json.dumps({
        "permission": "deny",
        "user_message": msg,
        "agent_message": f"Hook DENY: {msg}",
    }))
    return 2


def ask(msg: str) -> int:
    print(json.dumps({
        "permission": "ask",
        "user_message": msg,
        "agent_message": f"Hook ASK: {msg}",
    }))
    return 0


def main() -> int:
    try:
        data = json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError:
        print(json.dumps({"permission": "allow"}))
        return 0

    tool = (data.get("tool_name") or data.get("toolName") or "").lower()
    inp = data.get("tool_input") or data.get("arguments") or data.get("input") or {}
    if not isinstance(inp, dict):
        inp = {}

    s = load_session()
    touched = set(s.get("files") or [])

    if tool == "task":
        if inp.get("run_in_background") is True:
            n = bump_counter("background_jobs")
            if n > 2 and not os.environ.get("BLYP_ALLOW_BACKGROUND"):
                return deny("Background subagent cap — run in foreground or set BLYP_ALLOW_BACKGROUND=1.")

    if tool == "shell":
        cmd = inp.get("command") or ""
        if re.search(r"run_full_api_audit|generativelanguage\.googleapis", cmd, re.I):
            if not os.environ.get("BLYP_AUDIT_OK"):
                return ask("API audit — user must approve quota; set BLYP_AUDIT_OK=1 in shell env.")

    if tool in EDIT_TOOLS:
        paths = _paths_from_input(inp)
        if len(touched) > MAX_SCOPE_FILES and paths:
            new_paths = [p for p in paths if p not in touched]
            if new_paths and not os.environ.get("BLYP_WIDE_SCOPE"):
                return deny(
                    f"Session already touched {len(touched)} files — no new files without user OK."
                )

        if gate_failed() and paths:
            outsiders = [p for p in paths if p not in touched and not p.startswith("forensic/")]
            if outsiders and not os.environ.get("BLYP_GATE_OVERRIDE"):
                return deny(
                    "Last verify gate FAILED — only fix files already in this session, "
                    "or run npm run verify:session first."
                )

        for p in paths:
            if file_edit_count(p) >= MAX_FILE_EDITS and not os.environ.get("BLYP_CHURN_OVERRIDE"):
                return deny(
                    f"Edit churn on {p} ({file_edit_count(p)} edits) — verify hypothesis before more edits."
                )

    print(json.dumps({"permission": "allow"}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
