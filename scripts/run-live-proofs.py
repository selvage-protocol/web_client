#!/usr/bin/env python3
"""Run the public live proofs on loopback, with bounded processes and retained evidence."""

import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from contextlib import contextmanager
from urllib.error import URLError
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent.parent
_interrupted_signal = None


class ProofInterrupted(BaseException):
    def __init__(self, signum):
        self.signum = signum
        super().__init__(f"interrupted by {signal.Signals(signum).name}")


def check_interruption():
    if _interrupted_signal is not None:
        raise ProofInterrupted(_interrupted_signal)


@contextmanager
def managed_process(command, evidence, env=None, cwd=ROOT):
    """Own a process group even if its leader exits before its children."""
    with evidence.with_suffix(".stdout.log").open("wb") as stdout, \
            evidence.with_suffix(".stderr.log").open("wb") as stderr:
        process = subprocess.Popen(
            command, cwd=cwd, env=env, stdout=stdout, stderr=stderr,
            start_new_session=True,
        )
        try:
            check_interruption()
            yield process
        finally:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait(timeout=5)


def run_bounded(command, evidence, env=None, timeout=180, cwd=ROOT):
    result = {"command": command, "timeout_seconds": timeout}
    try:
        with managed_process(command, evidence, env, cwd) as process:
            deadline = time.monotonic() + timeout
            while True:
                check_interruption()
                try:
                    result["returncode"] = process.wait(timeout=min(0.1, max(0, deadline - time.monotonic())))
                    break
                except subprocess.TimeoutExpired:
                    if time.monotonic() >= deadline:
                        raise RuntimeError(f"{command} exceeded {timeout}s") from None
            check_interruption()
            if result["returncode"] != 0:
                raise RuntimeError(f"{command} exited {result['returncode']}")
        check_interruption()
    except BaseException as error:
        result["error"] = str(error)
        raise
    finally:
        evidence.with_suffix(".json").write_text(json.dumps(result, indent=2) + "\n")


def wait_for_server(process, evidence, timeout=15):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        check_interruption()
        if process.poll() is not None:
            raise RuntimeError(f"selvaged exited {process.returncode} before readiness")
        output = evidence.with_suffix(".stdout.log").read_text(errors="replace")
        match = re.search(r"ws://(127\.0\.0\.1:[0-9]+)/session", output)
        if match:
            address = match[1]
            try:
                with urlopen(f"http://{address}/meta", timeout=0.3) as response:
                    if response.status == 200:
                        return f"ws://{address}"
            except (URLError, TimeoutError):
                pass
        time.sleep(0.05)
    raise RuntimeError(f"selvaged did not become ready on loopback in {timeout}s")


def remove_profile(profile):
    def onerror(function, path, error):
        if not isinstance(error[1], FileNotFoundError):
            raise error[1]

    # Some browser proofs remove their own TMPDIR before the supervisor does.
    shutil.rmtree(profile, onerror=onerror)


def publish_result(evidence, completed, failures):
    # Re-stage if termination arrives during I/O; publish only a whole, current receipt.
    staged = evidence / ".result.json.tmp"
    while True:
        signum = _interrupted_signal
        interruption = None if signum is None else {"signal": signum, "name": signal.Signals(signum).name}
        staged.write_text(json.dumps({
            "completed": completed and interruption is None,
            "failures": failures, "interruption": interruption,
        }, indent=2) + "\n")
        if signum != _interrupted_signal:
            continue
        staged.replace(evidence / "result.json")
        if signum == _interrupted_signal:
            return interruption


def main():
    global _interrupted_signal
    _interrupted_signal = None
    binary = Path(os.environ["SELVAGE_SELVAGED"]).resolve(strict=True)
    browser = Path(os.environ["SELVAGE_CHROMIUM"]).resolve(strict=True)
    evidence = ROOT / ".tmp" / "live-proofs"
    evidence.mkdir(parents=True, exist_ok=False)
    failures = []
    completed = False
    interruption = None
    termination_signals = (signal.SIGTERM, signal.SIGINT)
    previous_handlers = {signum: signal.getsignal(signum) for signum in termination_signals}

    # Raising in a signal handler could bypass cleanup or interrupt the receipt itself.
    def interrupt(signum, frame):
        global _interrupted_signal
        if _interrupted_signal is None:
            _interrupted_signal = signum

    for signum in termination_signals:
        signal.signal(signum, interrupt)
    try:
        for proof in ["prove", "prove:fb2", "prove:flow2", "prove:v2", "prove:ghost"]:
            check_interruption()
            name = proof.replace(":", "-")
            profile = Path(tempfile.mkdtemp(prefix="live-profile-", dir=ROOT / ".tmp"))
            env = {
                **os.environ,
                "SELVAGE_SELVAGED": str(binary),
                "SELVAGE_CHROMIUM": str(browser),
                "SELVAGE_CHROMIUM_TMPDIR": str(profile.relative_to(ROOT)),
                "SELVAGE_CHROMIUM_PROFILE": str((profile / "browser").relative_to(ROOT)),
            }
            print(f"running {proof}", flush=True)
            try:
                if proof in ("prove:v2", "prove:ghost"):
                    run_bounded(["npm", "run", proof], evidence / name, env, timeout=240)
                else:
                    server_log = evidence / f"{name}-server"
                    with managed_process(
                        [str(binary), "--listen", "127.0.0.1:0"], server_log, env,
                    ) as server:
                        env["SELVAGE_BASE"] = wait_for_server(server, server_log)
                        run_bounded(["npm", "run", proof], evidence / name, env)
                print(f"passed {proof}", flush=True)
            except Exception as error:
                failures.append({"proof": proof, "error": str(error)})
                print(f"FAILED {proof}: {error}", file=sys.stderr, flush=True)
            finally:
                try:
                    remove_profile(profile)
                except Exception as error:
                    failures.append({"proof": proof, "cleanup_error": str(error)})
                    print(f"FAILED {proof} cleanup: {error}", file=sys.stderr, flush=True)
            check_interruption()
        completed = True
    except ProofInterrupted as error:
        print(str(error), file=sys.stderr, flush=True)
    finally:
        try:
            interruption = publish_result(evidence, completed, failures)
        finally:
            for signum, handler in previous_handlers.items():
                signal.signal(signum, handler)
    return 128 + interruption["signal"] if interruption is not None else int(bool(failures))


if __name__ == "__main__":
    sys.exit(main())
