"""Start the PDF Narrator server and open the UI.

    python -m narrator [--port 8765] [--no-browser]
"""
from __future__ import annotations

import argparse
import logging
import os
import socket
import subprocess
import sys
import threading
import time
import webbrowser


def _free_port(preferred: int) -> int:
    for port in [preferred] + list(range(preferred + 1, preferred + 50)):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if sys.platform != "win32":
                # a just-closed server leaves the port in TIME_WAIT; uvicorn can
                # still bind it, so the probe should too
                s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    return preferred


def _already_running(port: int) -> bool:
    import urllib.request
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/state", timeout=1.5) as r:
            return r.status == 200
    except Exception:
        return False


def _open_ui(url: str) -> None:
    """Prefer an app-style window (Edge/Chrome --app) so it feels like a desktop app."""
    if sys.platform == "win32":
        candidates = [
            os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
            os.path.expandvars(r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
            os.path.expandvars(r"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
            os.path.expandvars(r"%LocalAppData%\Google\Chrome\Application\chrome.exe"),
        ]
        for exe in candidates:
            if os.path.exists(exe):
                try:
                    subprocess.Popen([exe, f"--app={url}", "--start-maximized"])
                    return
                except OSError:
                    pass
    webbrowser.open(url)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="narrator")
    ap.add_argument("--port", type=int, default=int(os.environ.get("NARRATOR_PORT", "8765")))
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("--log", default="info")
    args = ap.parse_args(argv)
    logging.basicConfig(level=getattr(logging, args.log.upper(), logging.INFO),
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    if _already_running(args.port):
        print(f"PDF Narrator is already running on port {args.port}; opening it.")
        if not args.no_browser:
            _open_ui(f"http://127.0.0.1:{args.port}/")
        return 0
    port = _free_port(args.port)
    url = f"http://127.0.0.1:{port}/"
    import uvicorn
    from .app import create_app

    app = create_app()
    if not args.no_browser:
        def opener():
            for _ in range(60):
                if _already_running(port):
                    break
                time.sleep(0.25)
            _open_ui(url)
        threading.Thread(target=opener, daemon=True).start()
    print(f"PDF Narrator running at {url}  (close this window to stop)")
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
    return 0


if __name__ == "__main__":
    sys.exit(main())
