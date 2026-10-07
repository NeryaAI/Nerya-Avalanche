"""Start only the isolated competition services. No global Nerya service changes."""
from __future__ import annotations

import json
import argparse
import os
from pathlib import Path
import secrets
import signal
import socket
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
RUNTIME = ROOT / ".runtime"


def main() -> int:
    parser = argparse.ArgumentParser(description="Launch the original Nerya Agent in the isolated Avalanche worktree")
    parser.add_argument("--model-source", type=Path, help="Read only model profiles from this local workspace; secrets stay in memory")
    args = parser.parse_args()
    branch = subprocess.check_output(["git", "branch", "--show-current"], cwd=REPO, text=True).strip()
    if branch != "competition/avalanche-2026":
        raise RuntimeError("Refusing to start outside competition/avalanche-2026")
    for port in (18417, 18480):
        with socket.socket() as sock:
            if sock.connect_ex(("127.0.0.1", port)) == 0:
                raise RuntimeError(f"Port {port} is already in use; no existing process was stopped")
    python = REPO / ".venv-competition" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    next_bin = REPO / "node_modules/next/dist/bin/next"
    if not next_bin.is_file():
        next_bin = REPO / "dashboard/node_modules/next/dist/bin/next"
    if not python.is_file() or not next_bin.is_file():
        raise RuntimeError("Install the worktree's Python and Node dependencies first; see README.md")
    RUNTIME.mkdir(mode=0o700, parents=True, exist_ok=True)
    token_file = RUNTIME / "control-token"
    if not token_file.exists():
        token_file.write_text(secrets.token_urlsafe(48))
        token_file.chmod(0o600)
    token = token_file.read_text().strip()
    # Explicit environment selection avoids inheriting normal Nerya credentials,
    # API routing, model configuration or trading flags into the competition.
    env = {k: os.environ[k] for k in ("PATH", "HOME", "USER", "TMPDIR", "SYSTEMROOT", "WINDIR") if k in os.environ}
    env.update({"NERYA_COMPETITION": "avalanche", "NEXT_PUBLIC_NERYA_COMPETITION": "avalanche",
                "NERYA_COMPETITION_NATIVE": "1", "NERYA_COMPETITION_ROOT": str(ROOT),
                "NERYA_COMPETITION_TOKEN": token, "NERYA_COMPETITION_PYTHON": str(python),
                "NERYA_DASHBOARD_INTERNAL_TOKEN": token,
                "PORT": "18480", "NERYA_DASHBOARD_HOST": "127.0.0.1",
                "NERYA_COMPETITION_API_PORT": "18417", "NERYA_UI_DIST_DIR": ".next-avalanche-competition",
                "NERYA_API": "http://127.0.0.1:18417", "NEXT_TELEMETRY_DISABLED": "1",
                "PYTHONPATH": os.pathsep.join((str(REPO),str(REPO / "sdk/python"))),
                "PYTHONNOUSERSITE": "1", "PYTHONDONTWRITEBYTECODE": "1"})
    children: list[subprocess.Popen] = []
    logs = []
    def stop(*_):
        for child in children:
            if child.poll() is None:
                child.terminate()
    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    try:
        for name, command, cwd in (
            ("api", [str(python), str(ROOT / "scripts/native_runtime.py"),
                     *(["--model-source", str(args.model_source.resolve())] if args.model_source else [])], REPO),
            ("ui", ["node", str(REPO / "dashboard/scripts/local-server.cjs")], REPO / "dashboard"),
        ):
            log = (RUNTIME / f"{name}.log").open("a")
            logs.append(log)
            children.append(subprocess.Popen(command, cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT))
        (RUNTIME / "processes.json").write_text(json.dumps({"supervisor_pid": os.getpid(), "pids": [p.pid for p in children],
                                                        "ports": [18417, 18480], "branch": branch}, indent=2))
        print("Native Agent: http://127.0.0.1:18480/chat", flush=True)
        print("Normal ports 18317 / 18380 were not changed. Ctrl+C stops only these competition children.", flush=True)
        while all(child.poll() is None for child in children):
            time.sleep(0.5)
        stop()
        return next((p.returncode for p in children if p.returncode not in (None, 0, -15, -2)), 0)
    finally:
        stop()
        for child in children:
            try:
                child.wait(timeout=8)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
        for log in logs:
            log.close()


if __name__ == "__main__":
    raise SystemExit(main())
