"""Run the frontend data-layer smoke against a bounded local backend process.

Use a Python environment with the backend dependencies installed. Nothing is uploaded
or written to the configured point-cloud directory. The child is always reaped.
"""

import argparse
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
from urllib.error import URLError
from urllib.request import urlopen


def main() -> int:
    """Start the real API on an ephemeral port and exercise the frontend client/store."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", action="store_true", help="Exercise the F01–F04 workspace")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    with socket.socket() as listener, tempfile.TemporaryFile(mode="w+") as log:
        listener.bind(("127.0.0.1", 0))
        listener.listen()
        port = listener.getsockname()[1]
        base_url = f"http://127.0.0.1:{port}"
        process = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "app.main:app",
                "--fd",
                str(listener.fileno()),
            ],
            cwd=root / "backend",
            pass_fds=(listener.fileno(),),
            stdout=log,
            stderr=subprocess.STDOUT,
        )
        try:
            deadline = time.monotonic() + 60
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise RuntimeError("Backend exited before readiness")
                try:
                    with urlopen(f"{base_url}/health", timeout=1) as response:
                        if response.status == 200:
                            break
                except (URLError, TimeoutError):
                    time.sleep(0.1)
            else:
                raise TimeoutError("Backend readiness exceeded 60 seconds")
            env = {**os.environ, "SKYOPS_TEST_API_BASE_URL": base_url}
            return subprocess.run(
                ["npm", "run", "test:workspace:smoke" if args.workspace else "test:environment:smoke"],
                cwd=root / "frontend",
                env=env,
                timeout=120,
                check=False,
            ).returncode
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
            log.seek(0)
            print(log.read())


if __name__ == "__main__":
    raise SystemExit(main())
