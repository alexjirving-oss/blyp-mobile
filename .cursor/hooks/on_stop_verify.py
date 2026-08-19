#!/usr/bin/env python3
"""Fail-closed stop gate with fresh, independently revalidated receipts."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SESSION_PATH = os.path.join(ROOT, ".cursor", "agent", "session.json")
DIST_CLI = os.path.join(ROOT, "tools", "accountability", "dist", "src", "cli.js")
VERIFY_TIMEOUT_SECONDS = 900
VALIDATE_TIMEOUT_SECONDS = 60
BUILD_TIMEOUT_SECONDS = 120
# Concurrent WIP can rewrite already-dirty files without changing git status
# porcelain. Fresh verify+validate retries re-snapshot after those writers settle.
MAX_STALE_TOUCHED_FILE_RETRIES = 2


class StopBlocked(RuntimeError):
    """A clean completion is not supported by current evidence."""


def block(message: str) -> int:
    clean = " ".join(message.split())
    print(
        json.dumps(
            {
                "followup_message": (
                    "ACCOUNTABILITY STOP BLOCKED — do not claim completion. " + clean[:3500]
                )
            }
        )
    )
    return 2


def executable(name: str) -> str:
    value = shutil.which(name)
    if value is None:
        raise StopBlocked(f"required executable is unavailable: {name}")
    return os.path.abspath(value)


def npm_cli() -> str:
    configured = os.environ.get("npm_execpath")
    candidates: list[str] = []
    if configured:
        candidates.append(configured)
    npm_command = shutil.which("npm.cmd") or shutil.which("npm")
    if npm_command:
        node_dir = os.path.dirname(os.path.abspath(npm_command))
        candidates.append(os.path.join(node_dir, "node_modules", "npm", "bin", "npm-cli.js"))
        candidates.append(os.path.join(node_dir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"))
    for candidate in candidates:
        absolute = os.path.abspath(candidate)
        if os.path.isfile(absolute) and os.path.basename(absolute).lower() == "npm-cli.js":
            return absolute
    raise StopBlocked("could not resolve npm-cli.js without using a shell")


def run_checked(
    args: list[str],
    *,
    timeout: int,
    environment: dict[str, str],
    description: str,
) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            args,
            cwd=ROOT,
            env=environment,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired as error:
        raise StopBlocked(f"{description} timed out after {timeout} seconds") from error
    except OSError as error:
        raise StopBlocked(f"{description} crashed or could not start: {error}") from error


def parse_exact_json(output: str, description: str) -> dict:
    text = (output or "").strip()
    if not text:
        raise StopBlocked(f"{description} returned empty output")
    candidates = [text]
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        extracted = text[start : end + 1]
        if extracted != text:
            candidates.append(extracted)
    last_error: Exception | None = None
    for candidate in candidates:
        try:
            value = json.loads(candidate)
        except json.JSONDecodeError as error:
            last_error = error
            continue
        if isinstance(value, dict):
            return value
        last_error = StopBlocked(f"{description} did not return a JSON object")
    if isinstance(last_error, StopBlocked):
        raise last_error
    raise StopBlocked(f"{description} returned invalid JSON: {last_error}") from last_error


def validate_receipt_shape(receipt: dict) -> tuple[str, str, str]:
    if receipt.get("schema") != "blyp.verification-receipt" or receipt.get("version") != 1:
        raise StopBlocked("verifier returned an unsupported receipt schema")
    receipt_id = receipt.get("receiptId")
    binding = receipt.get("binding")
    outcome = receipt.get("outcome")
    if not isinstance(receipt_id, str) or not isinstance(binding, dict) or not isinstance(outcome, dict):
        raise StopBlocked("verifier receipt is incomplete")
    session_id = binding.get("sessionId")
    verdict = outcome.get("verdict")
    if not isinstance(session_id, str) or verdict not in {"PASS", "REJECTED", "BLOCKED"}:
        raise StopBlocked("verifier receipt has an invalid session binding or verdict")
    return receipt_id, session_id, verdict


def main() -> int:
    try:
        if not os.path.isfile(SESSION_PATH):
            raise StopBlocked("session.json is missing")
        node = executable("node")
        npm_path = npm_cli()
        environment = dict(os.environ)
        environment["npm_execpath"] = npm_path
        environment["CI"] = "true"
        environment["NO_COLOR"] = "1"
        environment["FORCE_COLOR"] = "0"

        build = run_checked(
            [node, npm_path, "run", "build", "--prefix", "tools/accountability"],
            timeout=BUILD_TIMEOUT_SECONDS,
            environment=environment,
            description="accountability controller build",
        )
        if build.returncode != 0 or not os.path.isfile(DIST_CLI):
            detail = (build.stderr or build.stdout or "compiled verifier is missing").strip()[-2500:]
            raise StopBlocked(f"accountability controller build failed: {detail}")

        attempt = 0
        while True:
            attempt += 1
            verification = run_checked(
                [
                    node,
                    DIST_CLI,
                    "verify-session",
                    "--repo",
                    ROOT,
                    "--session",
                    SESSION_PATH,
                ],
                timeout=VERIFY_TIMEOUT_SECONDS,
                environment=environment,
                description="session verification",
            )
            try:
                receipt = parse_exact_json(
                    (verification.stdout or verification.stderr).strip(),
                    "session verifier",
                )
            except StopBlocked as error:
                detail = (
                    verification.stderr or verification.stdout or "no verifier diagnostics"
                ).strip()[-2500:]
                raise StopBlocked(f"{error}; verifier diagnostics: {detail}") from error
            if receipt.get("status") == "BLOCKED":
                raise StopBlocked(str(receipt.get("error") or "session verification blocked"))
            receipt_id, session_id, verdict = validate_receipt_shape(receipt)
            receipt_path = os.path.join(
                ROOT,
                ".accountability",
                "sessions",
                session_id,
                receipt_id,
                "receipt.json",
            )
            if not os.path.isfile(receipt_path):
                raise StopBlocked("session verifier claimed a receipt that does not exist")

            validation = run_checked(
                [
                    node,
                    DIST_CLI,
                    "validate-receipt",
                    receipt_path,
                    "--repo",
                    ROOT,
                    "--session",
                    SESSION_PATH,
                    "--max-age-ms",
                    "120000",
                ],
                timeout=VALIDATE_TIMEOUT_SECONDS,
                environment=environment,
                description="receipt validation",
            )
            try:
                validation_result = parse_exact_json(
                    (validation.stdout or validation.stderr).strip(),
                    "receipt validator",
                )
            except StopBlocked as error:
                detail = (
                    validation.stderr or validation.stdout or "no validator diagnostics"
                ).strip()[-2500:]
                raise StopBlocked(f"{error}; validator diagnostics: {detail}") from error

            validation_error = str(validation_result.get("error") or "")
            stale_touched = "touched-file evidence is stale" in validation_error
            if validation_result.get("status") == "BLOCKED":
                if stale_touched and attempt <= MAX_STALE_TOUCHED_FILE_RETRIES:
                    # Re-run full verify so checks bind to the latest quiet tree snapshot.
                    continue
                raise StopBlocked(validation_error or "receipt validation blocked")
            if (
                validation.returncode != 0
                or validation_result.get("valid") is not True
                or validation_result.get("receiptId") != receipt_id
                or validation_result.get("verdict") != verdict
            ):
                detail = (validation.stderr or validation.stdout or "invalid receipt").strip()[
                    -2500:
                ]
                if stale_touched and attempt <= MAX_STALE_TOUCHED_FILE_RETRIES:
                    continue
                raise StopBlocked(f"receipt validation failed: {detail}")

            expected_code = 0 if verdict == "PASS" else 2 if verdict == "REJECTED" else 4
            if verification.returncode != expected_code:
                raise StopBlocked(
                    f"verifier exit code {verification.returncode} contradicts receipt verdict {verdict}"
                )
            if verdict != "PASS":
                detail = (verification.stderr or "mandatory checks did not pass").strip()[-2000:]
                raise StopBlocked(f"{verdict}: {detail}; receipt={receipt_path}")
            break
    except (StopBlocked, KeyError, OSError, TypeError, ValueError) as error:
        return block(str(error))

    print("{}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
