#!/usr/bin/env python3
"""Cheap process fixtures for the live-proof supervisor; no Rust, npm or browser build."""

import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

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

    def test_timeout_kills_the_leader_and_descendant(self):
        pid_file = self.root / "descendant.pid"
        source = (
            "import pathlib, subprocess, sys, time; "
            "p = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)']); "
            f"pathlib.Path({str(pid_file)!r}).write_text(str(p.pid)); "
            "time.sleep(60)"
        )
        with self.assertRaisesRegex(RuntimeError, "exceeded"):
            live.run_bounded(self.command(source), self.evidence, timeout=1)
        self.assertIn("exceeded", self.evidence.with_suffix(".json").read_text())
        self.assert_process_stopped(int(pid_file.read_text()))

    def test_children_are_killed_even_after_leader_exits(self):
        source = (
            "import subprocess, sys; "
            "p = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)']); "
            "print(p.pid)"
        )
        live.run_bounded(self.command(source), self.evidence)
        self.assert_process_stopped(int(self.evidence.with_suffix(".stdout.log").read_text()))

    def assert_process_stopped(self, pid):
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            path = Path(f"/proc/{pid}/stat")
            if not path.exists() or path.read_text().split()[2] == "Z":
                return
            time.sleep(0.02)
        self.fail(f"child {pid} survived cleanup")

    def test_profile_cleanup_accepts_prior_removal(self):
        profile = self.root / "profile"
        profile.mkdir()
        live.remove_profile(profile)
        live.remove_profile(profile)
        self.assertFalse(profile.exists())

    def test_profile_cleanup_refuses_permission_and_other_errors(self):
        for error in (PermissionError("denied"), OSError("broken filesystem")):
            def fail_cleanup(path, onerror):
                onerror(None, path, (type(error), error, None))
            with self.subTest(error=error), patch.object(live.shutil, "rmtree", fail_cleanup):
                with self.assertRaises(type(error)):
                    live.remove_profile(self.root / "profile")

    def test_sigterm_records_interruption_and_kills_both_groups(self):
        server = self.root / "server"
        server_pid = self.root / "server.pid"
        proof_pids = self.root / "proof.json"
        server.write_text(f"#!{sys.executable}\n" + f"""
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import os
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
server = HTTPServer(('127.0.0.1', 0), Handler)
Path({str(server_pid)!r}).write_text(str(os.getpid()))
print(f'ws://127.0.0.1:{{server.server_port}}/session', flush=True)
server.serve_forever()
""")
        server.chmod(0o755)
        npm = self.root / "npm"
        npm.write_text(f"#!{sys.executable}\n" + f"""
from pathlib import Path
import json, os, subprocess, sys, time
child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])
Path({str(proof_pids)!r}).write_text(json.dumps([os.getpid(), child.pid]))
time.sleep(60)
""")
        npm.chmod(0o755)
        wrapper = f"""
import importlib.util, pathlib, sys
spec = importlib.util.spec_from_file_location('live', {str(Path(live.__file__).resolve())!r})
live = importlib.util.module_from_spec(spec)
spec.loader.exec_module(live)
live.ROOT = pathlib.Path({str(self.root)!r})
sys.exit(live.main())
"""
        env = {**os.environ, "PATH": str(self.root) + os.pathsep + os.environ["PATH"],
               "SELVAGE_SELVAGED": str(server), "SELVAGE_CHROMIUM": sys.executable}
        pids = []
        with (self.root / "supervisor.log").open("wb") as output:
            supervisor = subprocess.Popen(self.command(wrapper), env=env, stdout=output, stderr=output)
            try:
                deadline = time.monotonic() + 10
                while time.monotonic() < deadline:
                    if proof_pids.exists():
                        try:
                            pids = json.loads(proof_pids.read_text())
                            break
                        except json.JSONDecodeError:
                            pass
                    self.assertIsNone(supervisor.poll(), (self.root / "supervisor.log").read_text())
                    time.sleep(0.02)
                self.assertEqual(len(pids), 2, "proof and descendant never started")
                pids.insert(0, int(server_pid.read_text()))
                supervisor.send_signal(signal.SIGTERM)
                self.assertEqual(supervisor.wait(timeout=10), 128 + signal.SIGTERM)
                for pid in pids:
                    self.assert_process_stopped(pid)
                result = json.loads((self.root / ".tmp/live-proofs/result.json").read_text())
                self.assertFalse(result["completed"])
                self.assertEqual(result["interruption"], {"signal": signal.SIGTERM, "name": "SIGTERM"})
                proof = json.loads((self.root / ".tmp/live-proofs/prove.json").read_text())
                self.assertIn("SIGTERM", proof["error"])
                self.assertFalse(list((self.root / ".tmp").glob("live-profile-*")))
            finally:
                if supervisor.poll() is None:
                    supervisor.kill()
                supervisor.wait(timeout=5)
                for pid in pids:
                    try:
                        os.killpg(pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass

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
