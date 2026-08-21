from __future__ import annotations

import contextlib
import importlib
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
import uuid
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

REPOSITORY = Path(__file__).resolve().parents[3]
HOOK_DIRECTORY = REPOSITORY / ".cursor" / "hooks"
sys.path.insert(0, str(HOOK_DIRECTORY))

session = importlib.import_module("lib.session")
stop = importlib.import_module("on_stop_verify")
after_edit = importlib.import_module("after_file_edit")


def timestamp() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class SessionStateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="blyp-hook-test-")
        self.root = os.path.abspath(self.temporary.name)
        self.agent = os.path.join(self.root, ".cursor", "agent")
        os.makedirs(self.agent, exist_ok=True)
        self.patches = [
            mock.patch.object(session, "ROOT", self.root),
            mock.patch.object(session, "AGENT_DIR", self.agent),
            mock.patch.object(session, "SESSION_PATH", os.path.join(self.agent, "session.json")),
            mock.patch.object(session, "LOCK_PATH", os.path.join(self.agent, ".session.lock")),
        ]
        for patcher in self.patches:
            patcher.start()

    def tearDown(self) -> None:
        for patcher in reversed(self.patches):
            patcher.stop()
        self.temporary.cleanup()

    def write_session(self) -> dict:
        now = timestamp()
        value = {
            "version": 1,
            "sessionId": str(uuid.uuid4()),
            "startedAt": now,
            "repoRoot": self.root,
            "baseSha": "a" * 40,
            "files": [],
            "lastEditAt": None,
            "editSequence": 0,
        }
        session._atomic_write_json(session.SESSION_PATH, value)
        return value

    def test_corrupt_session_fails_closed(self) -> None:
        Path(session.SESSION_PATH).write_text("{broken", encoding="utf-8")
        with self.assertRaises(session.SessionError):
            session.load_session_strict()

    def test_edit_tracking_is_atomic_and_strict(self) -> None:
        self.write_session()
        updated = session.add_edited_files(["src\\example.ts", "src/example.ts"])
        self.assertEqual(updated["files"], ["src/example.ts"])
        self.assertEqual(updated["editSequence"], 1)
        self.assertIsNotNone(updated["lastEditAt"])
        self.assertFalse(os.path.exists(session.LOCK_PATH))

    def test_runtime_state_cannot_be_recorded_as_an_agent_edit(self) -> None:
        self.write_session()
        with self.assertRaises(session.SessionError):
            session.add_edited_files([".cursor/agent/session.json"])

    def test_file_edit_payload_extraction_handles_cursor_shapes(self) -> None:
        payload = {
            "tool_input": {"file_path": "src/one.ts"},
            "edits": [{"path": "src/two.ts"}],
        }
        self.assertEqual(
            sorted(after_edit.extract_paths(payload)),
            ["src/one.ts", "src/two.ts"],
        )

class StopHookTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="blyp-stop-test-")
        self.root = os.path.abspath(self.temporary.name)
        self.session_path = os.path.join(self.root, ".cursor", "agent", "session.json")
        self.dist_cli = os.path.join(
            self.root, "tools", "accountability", "dist", "src", "cli.js"
        )
        os.makedirs(os.path.dirname(self.session_path), exist_ok=True)
        os.makedirs(os.path.dirname(self.dist_cli), exist_ok=True)
        Path(self.session_path).write_text("{}\n", encoding="utf-8")
        # Must look like the real accountability CLI so compiled_cli_is_ready() passes.
        Path(self.dist_cli).write_text(
            "// test stub\nexport async function runSessionVerification() {}\n"
            + ("// verify-session entry\n" * 8),
            encoding="utf-8",
        )
        self.patches = [
            mock.patch.object(stop, "ROOT", self.root),
            mock.patch.object(stop, "SESSION_PATH", self.session_path),
            mock.patch.object(stop, "DIST_CLI", self.dist_cli),
            mock.patch.object(stop, "executable", return_value="node"),
            mock.patch.object(stop, "npm_cli", return_value="npm-cli.js"),
        ]
        for patcher in self.patches:
            patcher.start()

    def tearDown(self) -> None:
        for patcher in reversed(self.patches):
            patcher.stop()
        self.temporary.cleanup()

    @staticmethod
    def process(returncode: int, stdout: str = "", stderr: str = "") -> subprocess.CompletedProcess:
        return subprocess.CompletedProcess([], returncode, stdout, stderr)

    def invoke(self, side_effect: list[object]) -> tuple[int, dict]:
        output = io.StringIO()
        with mock.patch.object(stop, "run_checked", side_effect=side_effect):
            with contextlib.redirect_stdout(output):
                code = stop.main()
        return code, json.loads(output.getvalue())

    def receipt(self, verdict: str) -> tuple[dict, str]:
        receipt_id = str(uuid.uuid4())
        session_id = str(uuid.uuid4())
        value = {
            "schema": "blyp.verification-receipt",
            "version": 1,
            "receiptId": receipt_id,
            "binding": {"sessionId": session_id},
            "outcome": {"verdict": verdict},
        }
        receipt_path = os.path.join(
            self.root,
            ".accountability",
            "sessions",
            session_id,
            receipt_id,
            "receipt.json",
        )
        os.makedirs(os.path.dirname(receipt_path), exist_ok=True)
        Path(receipt_path).write_text(json.dumps(value), encoding="utf-8")
        return value, receipt_path

    def test_timeout_blocks_clean_completion(self) -> None:
        code, output = self.invoke(
            [
                self.process(0),
                stop.StopBlocked("session verification timed out"),
            ]
        )
        self.assertEqual(code, 2)
        self.assertIn("timed out", output["followup_message"])

    def test_invalid_verifier_output_blocks_clean_completion(self) -> None:
        code, output = self.invoke([self.process(0), self.process(0, "looks good")])
        self.assertEqual(code, 2)
        self.assertIn("invalid JSON", output["followup_message"])

    def test_missing_receipt_blocks_clean_completion(self) -> None:
        value, receipt_path = self.receipt("PASS")
        os.unlink(receipt_path)
        code, output = self.invoke(
            [self.process(0), self.process(0, json.dumps(value))]
        )
        self.assertEqual(code, 2)
        self.assertIn("does not exist", output["followup_message"])

    def test_rejected_receipt_blocks_clean_completion(self) -> None:
        value, _ = self.receipt("REJECTED")
        validation = {
            "valid": True,
            "receiptId": value["receiptId"],
            "verdict": "REJECTED",
            "payloadSha256": "a" * 64,
        }
        code, output = self.invoke(
            [
                self.process(0),
                self.process(2, json.dumps(value), "tests failed"),
                self.process(0, json.dumps(validation)),
            ]
        )
        self.assertEqual(code, 2)
        self.assertIn("REJECTED", output["followup_message"])

    def test_fresh_valid_pass_allows_completion(self) -> None:
        value, _ = self.receipt("PASS")
        validation = {
            "valid": True,
            "receiptId": value["receiptId"],
            "verdict": "PASS",
            "payloadSha256": "a" * 64,
        }
        code, output = self.invoke(
            [
                self.process(0),
                self.process(0, json.dumps(value)),
                self.process(0, json.dumps(validation)),
            ]
        )
        self.assertEqual(code, 0)
        self.assertEqual(output, {})

    def test_empty_dist_cli_is_rejected_after_build(self) -> None:
        Path(self.dist_cli).write_text("", encoding="utf-8")
        code, output = self.invoke([self.process(0)])
        self.assertEqual(code, 2)
        self.assertIn("build failed", output["followup_message"])
        self.assertIn("dist_cli_bytes=0", output["followup_message"])

    def test_empty_verifier_output_rebuilds_once_then_passes(self) -> None:
        value, _ = self.receipt("PASS")
        validation = {
            "valid": True,
            "receiptId": value["receiptId"],
            "verdict": "PASS",
            "payloadSha256": "a" * 64,
        }
        code, output = self.invoke(
            [
                self.process(0),  # initial build
                self.process(0, "", ""),  # empty verifier output (truncated cli race)
                self.process(0),  # rebuild after empty output
                self.process(0, json.dumps(value)),
                self.process(0, json.dumps(validation)),
            ]
        )
        self.assertEqual(code, 0)
        self.assertEqual(output, {})

    def test_empty_verifier_output_reports_exit_and_cli_bytes(self) -> None:
        code, output = self.invoke(
            [
                self.process(0),
                self.process(0, "", ""),
                self.process(0),
                self.process(0, "", ""),
            ]
        )
        self.assertEqual(code, 2)
        self.assertIn("returned empty output", output["followup_message"])
        self.assertIn("exit=0", output["followup_message"])
        self.assertIn("dist_cli_bytes=", output["followup_message"])


if __name__ == "__main__":
    unittest.main()
