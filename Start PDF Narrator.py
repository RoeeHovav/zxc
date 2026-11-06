#!/usr/bin/env python3
"""PDF Narrator launcher.

Double-click this file (it opens with Python).  It needs nothing but Python 3.10+
and an internet connection the first time:

  1. creates a private environment in the ".venv" folder next to this file,
  2. installs the pinned libraries listed in requirements.txt from pypi.org
     (wheels only -- nothing is compiled or executed during install),
  3. checks that every library really loads and, if Windows (Smart App Control /
     Application Control) blocks one, says exactly which file and what to do,
  4. downloads Hebrew + English OCR data (checked against a fixed SHA-256),
  5. starts the reader and opens it in your browser.

There is deliberately no .bat / .ps1 / .exe here: the only program that runs is
python.exe, which is signed by the Python Software Foundation.

Options:  --console (show the server log in this window)   --no-browser
          --check (set up and test, do not start)           --reinstall
          --port N
"""
from __future__ import annotations

import argparse
import hashlib
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VENV = ROOT / ".venv"
WIN = sys.platform == "win32"
MODULES = [  # (import name, required?)
    ("pymupdf", True), ("fastapi", True), ("pydantic_core", True), ("uvicorn", True), ("multipart", True),
    ("httpx", True), ("edge_tts", True), ("lameenc", False),
]
# Fixed OCR files (tessdata_fast, Apache-2.0).  A download that does not match is discarded.
OCR_FILES = {
    "heb": ("https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/heb.traineddata",
            "11f9e43ab227f786352a50f75c94c2e9906f1baba86d93276da19da7ce0904db"),
    "eng": ("https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/eng.traineddata",
            "7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2"),
}
BLOCK_PATTERN = re.compile(r"application control|blocked this file|blocked by|code integrity|WinError 4551|smart app control",
                           re.IGNORECASE)


def say(msg: str = "") -> None:
    print(f"[PDF Narrator] {msg}" if msg else "", flush=True)


def venv_python(windowless: bool = False) -> Path:
    if WIN:
        return VENV / "Scripts" / ("pythonw.exe" if windowless else "python.exe")
    return VENV / "bin" / "python"


def data_dir() -> Path:
    sys.path.insert(0, str(ROOT))
    try:
        from narrator.config import data_dir as d
        return Path(d())
    finally:
        sys.path.pop(0)


def classify_failure(module: str, output: str) -> dict:
    """Turn the text of a failed import into a diagnosis."""
    blocked = bool(BLOCK_PATTERN.search(output))
    dll = re.search(r"DLL load failed while importing (\w+)", output)
    return {"module": module, "blocked": blocked, "detail": output.strip().splitlines()[-1] if output.strip() else "",
            "native": dll.group(1) if dll else None}


SMART_APP_CONTROL_HELP = """\
Windows is blocking one of the program's libraries (not PDF Narrator's own files).
This is "Smart App Control" (or an Application Control policy). It blocks any program
file that is not digitally signed by a company Microsoft already trusts, and it has no
"allow this one file" option. The libraries involved are the normal, public PyPI
packages listed in requirements.txt; they are simply not signed.

What you can do:
  1. Windows Security > App & browser control > Smart App Control settings > choose Off.
     Then start PDF Narrator again.  (Windows asks you to confirm.)
     On older Windows 11 versions, turning it Off could not be undone without
     reinstalling Windows; recent updates reportedly allow turning it back on.
     Check your Windows version before deciding.
  2. Or keep it On and tell the developer which file is blocked (see above) so a
     workaround can be built.
To see the exact blocked file: Event Viewer > Applications and Services Logs >
Microsoft > Windows > CodeIntegrity > Operational (look for events 3076/3077).
"""


def run(cmd: list, **kw) -> subprocess.CompletedProcess:
    return subprocess.run([str(c) for c in cmd], **kw)


def ensure_venv(reinstall: bool) -> None:
    if reinstall and VENV.exists():
        say("Removing the old environment...")
        shutil.rmtree(VENV, ignore_errors=True)
    if venv_python().exists():
        return
    say(f"Using Python {sys.version_info.major}.{sys.version_info.minor} - creating a private environment (one time)...")
    import venv
    venv.EnvBuilder(with_pip=True, clear=False).create(str(VENV))


def requirements_hash() -> str:
    return hashlib.sha256((ROOT / "requirements.txt").read_bytes()).hexdigest()


def install_requirements(h: str) -> bool:
    marker = VENV / ".installed"
    if marker.exists() and marker.read_text().strip() == h:
        return True
    say("Installing components from pypi.org (first start can take a few minutes)...")
    r = run([venv_python(), "-m", "pip", "install", "--disable-pip-version-check", "--only-binary=:all:", "-r",
             ROOT / "requirements.txt"])
    if r.returncode != 0:
        say("Installing the components failed. Check your internet connection and try again.")
        return False
    marker.write_text(h)
    return True


def smoke_test(h: str) -> bool:
    """Import every library in its own process so one blocked file cannot hide another."""
    ok_marker = VENV / ".verified"
    if ok_marker.exists() and ok_marker.read_text().strip() == h:
        return True
    say("Checking that every component loads...")
    failures = []
    for mod, required in MODULES:
        r = run([venv_python(), "-I", "-c", f"import {mod}"], capture_output=True, text=True)
        if r.returncode != 0:
            f = classify_failure(mod, r.stderr or r.stdout)
            f["required"] = required
            failures.append(f)
    # the application itself (loads everything together)
    r = run([venv_python(), "-c", "import narrator.app"], cwd=ROOT, capture_output=True, text=True)
    if r.returncode != 0 and not failures:
        failures.append({**classify_failure("narrator.app", r.stderr or r.stdout), "required": True})
    fatal = [f for f in failures if f["required"]]
    for f in failures:
        say(f"{'PROBLEM' if f['required'] else 'optional'}: '{f['module']}' did not load: {f['detail']}")
    if fatal:
        if any(f["blocked"] for f in fatal):
            say()
            print(SMART_APP_CONTROL_HELP)
        return False
    if failures:
        say("The optional component(s) above are unavailable; PDF Narrator will use a built-in fallback.")
    ok_marker.write_text(h)
    return True


def sha256(path: Path) -> str:
    d = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            d.update(block)
    return d.hexdigest()


def ensure_ocr_data() -> None:
    tess = data_dir() / "tessdata"
    tess.mkdir(parents=True, exist_ok=True)
    for lang, (url, digest) in OCR_FILES.items():
        target = tess / f"{lang}.traineddata"
        if target.exists() and sha256(target) == digest:
            continue
        part = target.with_suffix(".part")
        try:
            say(f"Downloading OCR data for scanned pages: {lang}")
            with urllib.request.urlopen(url, timeout=60) as resp, open(part, "wb") as out:
                shutil.copyfileobj(resp, out)
            if sha256(part) != digest:
                raise RuntimeError("checksum mismatch")
            os.replace(part, target)
        except Exception as exc:
            part.unlink(missing_ok=True)
            say(f"Could not get OCR data '{lang}' ({exc}). Scanned pages will be flagged until it is available.")


def server_up(port: int) -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/state", timeout=1.5) as r:
            return r.status == 200
    except Exception:
        return False


def start_server(port: int, no_browser: bool, console: bool) -> int:
    cmd = [venv_python(windowless=not console), "-m", "narrator", "--port", str(port)]
    if no_browser:
        cmd.append("--no-browser")
    env = dict(os.environ)
    if console:
        say("Starting (close this window to stop)...")
        return run(cmd, cwd=ROOT, env=env).returncode
    kw: dict = {}
    if WIN:
        kw["creationflags"] = 0x00000008 | 0x00000200 | 0x08000000  # DETACHED | NEW_PROCESS_GROUP | NO_WINDOW
    else:
        kw["start_new_session"] = True
    say("Starting...")
    proc = subprocess.Popen([str(c) for c in cmd], cwd=ROOT, env=env, stdin=subprocess.DEVNULL,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **kw)
    deadline = time.time() + 60
    while time.time() < deadline:
        if server_up(port):
            say(f"Running at http://127.0.0.1:{port}/  (the reader opens in your browser)")
            return 0
        if proc.poll() is not None:
            break
        time.sleep(0.4)
    # failed: show the real error
    say("PDF Narrator did not start. Details:")
    r = run([venv_python(), "-c", "import narrator.app"], cwd=ROOT, capture_output=True, text=True)
    out = (r.stderr or r.stdout or "").strip()
    print(out[-1500:] if out else "(no error text; see narrator.log in " + str(data_dir()) + ")")
    if BLOCK_PATTERN.search(out):
        print(SMART_APP_CONTROL_HELP)
    return 1


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Start PDF Narrator")
    ap.add_argument("--console", action="store_true")
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("--check", action="store_true", help="set up and test only")
    ap.add_argument("--reinstall", action="store_true")
    ap.add_argument("--port", type=int, default=int(os.environ.get("NARRATOR_PORT", "8765")))
    args = ap.parse_args(argv)
    if sys.version_info < (3, 10):
        say("Python 3.10 or newer is required. Install it from https://www.python.org/downloads/ (or the Microsoft Store).")
        return 1
    try:
        ensure_venv(args.reinstall)
        h = requirements_hash()
        if not install_requirements(h):
            return 1
        if not smoke_test(h):
            return 1
        ensure_ocr_data()
        if args.check:
            say("Everything is installed and loads correctly.")
            return 0
        return start_server(args.port, args.no_browser, args.console)
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    code = main()
    if code == 0 and WIN:
        time.sleep(2.5)  # let the "running at" line be read before the window closes
    if code not in (0, 130) and sys.stdin is not None and sys.stdin.isatty():
        input("\nPress Enter to close this window...")
    sys.exit(code)
