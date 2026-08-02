"""Strict, atomic state handling for Cursor accountability hooks."""
from __future__ import annotations

import json
import os
import subprocess
import tempfile
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Iterator

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
AGENT_DIR = os.path.join(ROOT, ".cursor", "agent")
SESSION_PATH = os.path.join(AGENT_DIR, "session.json")
LOCK_PATH = os.path.join(AGENT_DIR, ".session.lock")
SESSION_KEYS = {
    "version",
    "sessionId",
    "startedAt",
    "repoRoot",
    "baseSha",
    "files",
    "lastEditAt",
    "editSequence",
}


class SessionError(RuntimeError):
    """Raised when accountability state is absent, corrupt, or unsafe."""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _run_git(args: list[str]) -> str:
    try:
        result = subprocess.run(
            ["git", *args],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise SessionError(f"git {' '.join(args)} could not run: {error}") from error
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "unknown error").strip()
        raise SessionError(f"git {' '.join(args)} failed: {detail}")
    return result.stdout.strip()


def repository_root() -> str:
    root = os.path.abspath(_run_git(["rev-parse", "--show-toplevel"]))
    if os.path.normcase(root) != os.path.normcase(ROOT):
        raise SessionError(f"hook root mismatch: expected {ROOT}, git returned {root}")
    return root


def current_head() -> str:
    value = _run_git(["rev-parse", "--verify", "HEAD^{commit}"]).lower()
    if len(value) not in (40, 64) or any(character not in "0123456789abcdef" for character in value):
        raise SessionError("git returned an invalid HEAD commit")
    return value


@contextmanager
def session_lock(timeout_seconds: float = 5.0) -> Iterator[None]:
    os.makedirs(AGENT_DIR, exist_ok=True)
    deadline = time.monotonic() + timeout_seconds
    descriptor: int | None = None
    while descriptor is None:
        try:
            descriptor = os.open(LOCK_PATH, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(descriptor, f"{os.getpid()} {utc_now()}\n".encode("utf-8"))
            os.fsync(descriptor)
        except FileExistsError:
            try:
                if time.time() - os.path.getmtime(LOCK_PATH) > 30:
                    os.unlink(LOCK_PATH)
                    continue
            except FileNotFoundError:
                continue
            if time.monotonic() >= deadline:
                raise SessionError("timed out acquiring the accountability session lock")
            time.sleep(0.05)
    try:
        yield
    finally:
        os.close(descriptor)
        try:
            os.unlink(LOCK_PATH)
        except FileNotFoundError:
            pass


def _atomic_write_json(destination: str, value: object) -> None:
    os.makedirs(os.path.dirname(destination), exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(
        dir=os.path.dirname(destination),
        prefix=".accountability-",
        suffix=".tmp",
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(value, handle, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, destination)
    except BaseException:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise


def _validate_timestamp(value: object, name: str, *, nullable: bool = False) -> str | None:
    if nullable and value is None:
        return None
    if not isinstance(value, str) or not value.endswith("Z"):
        raise SessionError(f"{name} must be an ISO-8601 UTC timestamp")
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise SessionError(f"{name} is not a valid timestamp") from error
    return value


def _validate_session(value: object) -> dict:
    if not isinstance(value, dict):
        raise SessionError("session.json must contain an object")
    if set(value) != SESSION_KEYS:
        missing = sorted(SESSION_KEYS - set(value))
        unknown = sorted(set(value) - SESSION_KEYS)
        raise SessionError(f"session.json shape mismatch; missing={missing}, unknown={unknown}")
    if value.get("version") != 1:
        raise SessionError("session.json version must be 1")
    try:
        uuid.UUID(str(value.get("sessionId")))
    except (ValueError, TypeError, AttributeError) as error:
        raise SessionError("sessionId must be a UUID") from error
    started_at = _validate_timestamp(value.get("startedAt"), "startedAt")
    last_edit_at = _validate_timestamp(value.get("lastEditAt"), "lastEditAt", nullable=True)
    if last_edit_at is not None and started_at is not None and last_edit_at < started_at:
        raise SessionError("lastEditAt cannot precede startedAt")
    if not isinstance(value.get("repoRoot"), str):
        raise SessionError("repoRoot must be a path")
    if os.path.normcase(os.path.abspath(value["repoRoot"])) != os.path.normcase(ROOT):
        raise SessionError("session.json belongs to another repository")
    base_sha = value.get("baseSha")
    if (
        not isinstance(base_sha, str)
        or len(base_sha) not in (40, 64)
        or any(character not in "0123456789abcdef" for character in base_sha)
    ):
        raise SessionError("baseSha must be a lowercase Git commit")
    files = value.get("files")
    if not isinstance(files, list) or len(files) > 500 or not all(isinstance(item, str) for item in files):
        raise SessionError("files must be an array of at most 500 paths")
    normalized = [normalize_repo_path(item) for item in files]
    if normalized != sorted(set(normalized)):
        raise SessionError("session file paths must be unique and sorted")
    sequence = value.get("editSequence")
    if not isinstance(sequence, int) or isinstance(sequence, bool) or sequence < 0:
        raise SessionError("editSequence must be a non-negative integer")
    return dict(value)


def load_session_strict() -> dict:
    try:
        with open(SESSION_PATH, encoding="utf-8-sig") as handle:
            return _validate_session(json.load(handle))
    except FileNotFoundError as error:
        raise SessionError("session.json is missing") from error
    except json.JSONDecodeError as error:
        raise SessionError(f"session.json is not valid JSON: {error}") from error
    except OSError as error:
        raise SessionError(f"session.json could not be read: {error}") from error


def create_session() -> dict:
    root = repository_root()
    session = {
        "version": 1,
        "sessionId": str(uuid.uuid4()),
        "startedAt": utc_now(),
        "repoRoot": root,
        "baseSha": current_head(),
        "files": [],
        "lastEditAt": None,
        "editSequence": 0,
    }
    with session_lock():
        _atomic_write_json(SESSION_PATH, session)
    return session


def normalize_repo_path(value: str) -> str:
    if not isinstance(value, str) or not value.strip() or "\x00" in value:
        raise SessionError("file path is empty or invalid")
    candidate = value.strip().replace("\\", "/")
    if candidate.startswith("file://"):
        candidate = candidate[7:]
    if os.path.isabs(candidate) or (len(candidate) >= 2 and candidate[1] == ":"):
        absolute = os.path.abspath(candidate)
        try:
            common = os.path.commonpath([ROOT, absolute])
        except ValueError as error:
            raise SessionError(f"path is outside the repository: {value}") from error
        if os.path.normcase(common) != os.path.normcase(ROOT):
            raise SessionError(f"path is outside the repository: {value}")
        candidate = os.path.relpath(absolute, ROOT).replace("\\", "/")
    while candidate.startswith("./"):
        candidate = candidate[2:]
    parts = candidate.split("/")
    if not candidate or candidate.startswith("/") or any(part in ("", ".", "..") for part in parts):
        raise SessionError(f"unsafe repository path: {value}")
    normalized = "/".join(parts)
    if normalized.startswith(".cursor/agent/") or normalized == ".cursor/agent":
        raise SessionError("agents may not edit accountability runtime state")
    return normalized


def add_edited_files(paths: list[str]) -> dict:
    if not paths:
        raise SessionError("afterFileEdit did not provide a file path")
    normalized = sorted(set(normalize_repo_path(path_value) for path_value in paths))
    with session_lock():
        session = load_session_strict()
        session["files"] = sorted(set(session["files"]) | set(normalized))
        session["lastEditAt"] = utc_now()
        session["editSequence"] = int(session["editSequence"]) + 1
        _atomic_write_json(SESSION_PATH, session)
    return session
