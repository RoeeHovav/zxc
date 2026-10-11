#!/usr/bin/env python3
"""
Split a large PDF into smaller, self-contained parts that fit an upload limit.

Runs 100% locally (no web service), so a restricted document never leaves your
computer except where you choose to send the parts.

Usage (Windows PowerShell or any shell):
    pip install pypdf
    python tools/split_pdf.py "C:\\Users\\roeeh\\Downloads\\<book>.pdf" --max-mb 4

Output goes to ./split_parts/ next to where you run the command. Part files have
ASCII-only names (Hebrew characters in file names get mangled by some uploaders).
The script also prints the SHA-256 of the original file so the exact edition can
be recorded and verified later.

Parts are never split mid-page. If a single page is larger than the limit it is
written on its own and reported.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import sys
from pathlib import Path

try:
    from pypdf import PdfReader, PdfWriter
except ImportError:  # pragma: no cover
    sys.exit("pypdf is required:  pip install pypdf")


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def render(reader: PdfReader, start: int, end: int) -> bytes:
    """Serialise pages [start, end) into a standalone PDF and return its bytes."""
    writer = PdfWriter()
    for i in range(start, end):
        writer.add_page(reader.pages[i])
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


def split_range(reader: PdfReader, start: int, end: int, limit: int, out: list):
    data = render(reader, start, end)
    if len(data) <= limit or end - start == 1:
        out.append((start, end, data))
        return
    mid = (start + end) // 2
    split_range(reader, start, mid, limit, out)
    split_range(reader, mid, end, limit, out)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pdf", type=Path, help="path to the PDF to split")
    ap.add_argument("--max-mb", type=float, default=4.0, help="target maximum size of each part in MB (default 4)")
    ap.add_argument("--out", type=Path, default=Path("split_parts"), help="output folder (default ./split_parts)")
    args = ap.parse_args()

    if not args.pdf.is_file():
        return print(f"File not found: {args.pdf}") or 1

    reader = PdfReader(str(args.pdf))
    if reader.is_encrypted:
        print("The PDF is encrypted/password-protected; remove the protection first (if you are entitled to).")
        return 1

    total = len(reader.pages)
    limit = int(args.max_mb * 1024 * 1024)
    print(f"File     : {args.pdf.name}")
    print(f"Size     : {args.pdf.stat().st_size / 1024 / 1024:.1f} MB, {total} pages")
    print(f"SHA-256  : {sha256_of(args.pdf)}")

    parts: list = []
    split_range(reader, 0, total, limit, parts)

    args.out.mkdir(parents=True, exist_ok=True)
    oversized = []
    for n, (start, end, data) in enumerate(parts, 1):
        name = f"part-{n:03d}_pages-{start + 1}-{end}.pdf"
        (args.out / name).write_bytes(data)
        flag = ""
        if len(data) > limit:
            flag = "  <-- single page larger than limit"
            oversized.append(name)
        print(f"  {name}  {len(data) / 1024 / 1024:.2f} MB{flag}")

    print(f"\nWrote {len(parts)} part(s) to {args.out.resolve()}")
    print("Attach the parts (in order) to the chat, or put them in a PRIVATE location. "
          "Do NOT commit them to a public repository.")
    if oversized:
        print("Some single pages exceed the limit; try a larger --max-mb (e.g. 8).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
