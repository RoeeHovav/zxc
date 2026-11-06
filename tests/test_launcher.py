"""The Python launcher (replaces .bat/.ps1 so no script is blocked by Windows) and pinned requirements."""
import importlib.util
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load():
    spec = importlib.util.spec_from_file_location("launcher", ROOT / "Start PDF Narrator.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_requirements_are_exactly_pinned():
    lines = [l.strip() for l in (ROOT / "requirements.txt").read_text().splitlines() if l.strip() and not l.startswith("#")]
    assert lines and all(re.fullmatch(r"[A-Za-z0-9_.\-]+==\d+(\.\d+)*", l) for l in lines), lines
    assert not any("lingua" in l for l in lines)


def test_no_windows_scripts_are_shipped():
    shipped = [p.name for p in ROOT.iterdir() if p.suffix.lower() in (".bat", ".cmd", ".ps1", ".vbs", ".exe")]
    assert shipped == []
    assert not list((ROOT / "scripts").rglob("*.ps1"))


def test_blocked_file_is_diagnosed():
    m = load()
    err = ("Traceback (most recent call last):\n  File \"x\", line 1, in <module>\nImportError: DLL load failed while "
           "importing _mupdf: An Application Control policy has blocked this file.\n")
    f = m.classify_failure("pymupdf", err)
    assert f["blocked"] and f["native"] == "_mupdf" and "Application Control" in f["detail"]
    assert not m.classify_failure("x", "ModuleNotFoundError: No module named 'x'")["blocked"]
    assert "Smart App Control" in m.SMART_APP_CONTROL_HELP and "Off" in m.SMART_APP_CONTROL_HELP


def test_ocr_checksums_declared():
    m = load()
    assert set(m.OCR_FILES) == {"heb", "eng"}
    assert all(re.fullmatch(r"[0-9a-f]{64}", d) and u.startswith("https://") for u, d in m.OCR_FILES.values())


def test_speech_client_uses_pure_python_modules():
    import subprocess, sys
    code = ("import sys; import narrator.__main__, edge_tts, aiohttp, yarl, multidict, frozenlist; "
            "bad=[m for m in sys.modules if m.endswith(('_http_parser','_multidict','_quoting_c','_frozenlist'))]; "
            "assert not bad, bad")
    r = subprocess.run([sys.executable, "-c", code], cwd=ROOT, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
