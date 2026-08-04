#!/usr/bin/env python3
"""Gate shell: block builds, quota burners, secrets-in-cmd, unapproved audits."""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from lib.session import bump_counter, get_counter, load_session  # noqa: E402

ALLOW = {"permission": "allow"}

DENY = [
    (r"BUILD_RELEASE_CANDIDATE", "Release build blocked. User must explicitly say to build."),
    (r"\beas\s+build\b", "EAS build blocked."),
    (r"\bgradle\b.*\bbundle\b", "Gradle bundle blocked."),
    (r"git\s+push\b[^\n]*(--force|\s-f\b)", "Force push blocked."),
    (r"git\s+reset\s+--hard", "Hard reset blocked."),
    (r"git\s+clean\s+-fd", "git clean -fd blocked."),
    (r"npm\s+publish\b", "npm publish blocked."),
    (r"firebase\s+deploy\b", "firebase deploy blocked without user approval."),
    (r"Stop-Process\b.*node", "Killing all node processes blocked (use targeted stop)."),
]

ASK = [
    (r"run_full_api_audit\.py", "API audit burns quota. Need: Pro-first, N<=12, 18s delay, user OK."),
    (r"generativelanguage\.googleapis\.com", "Gemini API HTTP call — quota risk."),
    (r"forensic/.*\.py", "Forensic script — confirm scope and that browser/API quota is acceptable."),
    (r"block_until_ms:\s*0", "Background command — confirm with user."),
    (r"run_in_background", "Background job — confirm with user."),
    (r"GEMINI_API_KEY=|EXPO_PUBLIC_GEMINI_API_KEY=|GOOGLE_API_KEY=", "Set API key via env, not inline in command."),
    (r"\bAIza[0-9A-Za-z_-]{20,}\b", "Possible API key embedded in command."),
    (r"\bAQ\.[0-9A-Za-z_-]{20,}\b", "Possible auth key embedded in command."),
    (r"curl\b.*(-d|--data)", "curl POST — confirm not exfiltrating secrets."),
]

# Hard caps per session (deny after threshold)
SESSION_CAPS = [
    ("shell_commands", 80, "Too many shell commands this session — stop and summarize for user."),
    ("api_http_calls", 25, "Too many API calls this session — quota protection."),
    ("background_jobs", 3, "Too many background jobs — stop and report status."),
]


def deny(msg: str) -> None:
    print(json.dumps({
        "permission": "deny",
        "user_message": msg,
        "agent_message": f"Hook DENY: {msg}",
    }))
    sys.exit(2)


def ask(msg: str) -> None:
    print(json.dumps({
        "permission": "ask",
        "user_message": msg,
        "agent_message": f"Hook ASK: {msg}",
    }))
    sys.exit(0)


def main() -> int:
    try:
        data = json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError:
        print(json.dumps(ALLOW))
        return 0

    command = data.get("command") or data.get("cmd") or ""
    if not command:
        print(json.dumps(ALLOW))
        return 0

    bump_counter("shell_commands")

    if re.search(r"block_until_ms:\s*0|run_in_background", command, re.I):
        bump_counter("background_jobs")

    if re.search(r"generativelanguage\.googleapis\.com|run_full_api_audit", command, re.I):
        bump_counter("api_http_calls")

    s = load_session()
    for key, cap, msg in SESSION_CAPS:
        if int(s.get(key) or 0) > cap:
            deny(msg)

    for pat, msg in DENY:
        if re.search(pat, command, re.I):
            deny(msg)

    for pat, msg in ASK:
        if re.search(pat, command, re.I):
            ask(msg)

    print(json.dumps(ALLOW))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
