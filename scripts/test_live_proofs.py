#!/usr/bin/env python3
"""Cheap process fixtures for the live-proof supervisor; no Rust, npm or browser build."""

import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import time
import unittest

spec = importlib.util.spec_from_file_location(
    "live_proofs", Path(__file__).with_name("run-live-proofs.py"),
)
live = importlib.util.module_from_spec(spec)
spec.loader.exec_module(live)


class LiveProofSupervisorTests(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory()
        self.addCleanup(self.scratch.cleanup)
        self.root = Path(self.scratch.name)
        self.evidence = self.root / "proof"

    def command(self, source):
        return [sys.executable, "-u", "-c", source]

    def test_whole_streams_and_success(self):
        live.run_bounded(self.command("import sys; print('out'); print('err', file=sys.stderr)"), self.evidence)
        self.assertEqual(self.evidence.with_suffix(".stdout.log").read_text(), "out\n")
        self.assertEqual(self.evidence.with_suffix(".stderr.log").read_text(), "err\n")
        self.assertEqual(json.loads(self.evidence.with_suffix(".json").read_text())["returncode"], 0)

    def test_failure_is_not_success(self):
        with self.assertRaisesRegex(RuntimeError, "exited 7"):
            live.run_bounded(self.command("raise SystemExit(7)"), self.evidence)
        self.assertIn("error", json.loads(self.evidence.with_suffix(".json").read_text()))

    def test_timeout_kills_the_leader(self):
        with self.assertRaisesRegex(RuntimeError, "exceeded"):
            live.run_bounded(self.command("import time; time.sleep(60)"), self.evidence, timeout=0.1)
        self.assertIn("exceeded", self.evidence.with_suffix(".json").read_text())

    def test_children_are_killed_even_after_leader_exits(self):
        source = (
            "import subprocess, sys; "
            "p = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)']); "
            "print(p.pid)"
        )
        live.run_bounded(self.command(source), self.evidence)
        pid = int(self.evidence.with_suffix(".stdout.log").read_text())
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            path = Path(f"/proc/{pid}/stat")
            if not path.exists() or path.read_text().split()[2] == "Z":
                return
            time.sleep(0.02)
        self.fail(f"child {pid} survived cleanup")

    def test_server_startup_is_bounded_and_reaped(self):
        with live.managed_process(self.command("import time; time.sleep(60)"), self.evidence) as process:
            with self.assertRaisesRegex(RuntimeError, "did not become ready on loopback"):
                live.wait_for_server(process, self.evidence, timeout=0.1)
        self.assertIsNotNone(process.returncode)

    def test_server_readiness_uses_its_reported_loopback_meta(self):
        source = """
from http.server import BaseHTTPRequestHandler, HTTPServer
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200 if self.path == '/meta' else 404)
        self.end_headers()
server = HTTPServer(('127.0.0.1', 0), Handler)
print(f'ws://127.0.0.1:{server.server_port}/session', flush=True)
server.serve_forever()
"""
        with live.managed_process(self.command(source), self.evidence) as process:
            self.assertRegex(live.wait_for_server(process, self.evidence), r"^ws://127\.0\.0\.1:[0-9]+$")


if __name__ == "__main__":
    unittest.main()
