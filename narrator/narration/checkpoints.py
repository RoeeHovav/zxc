"""Where a comprehension checkpoint goes.

A checkpoint covers the stretch of narration the listener has just heard.  The stretch ends at a natural
break -- the end of a section, the end of a page, or after about N minutes -- and never in the middle of a
paragraph, right after a heading, or after a line that introduces a list ("...as follows:").

The plan is made on the server, from the same units the narrator reads, so the questions for a stretch can be
written while the listener is still in it (no waiting when the stretch ends).
"""
from __future__ import annotations

from typing import Callable, Dict, List, Optional

CHARS_PER_MINUTE = 900   # the same figure the "narrated so far" meter uses
MIN_CHARS = 1100         # about a minute and a quarter: less than this is not worth a quiz
CAP_CHARS = 9000         # about ten minutes: a document without headings is still checked now and then
BODY = ("paragraph", "list_item", "note")
NEVER = ("header", "footer", "page_number", "toc", "figure_text", "artifact")
MODES = ("off", "section", "page", "minutes")


def _last_page(u) -> int:
    return u.words[-1][0] if u.words else u.page


def _first_page(u) -> int:
    return u.words[0][0] if u.words else u.page


def readable(u, read_kinds: Dict[str, bool]) -> bool:
    return u.kind not in NEVER and read_kinds.get(u.kind, True) is not False and bool(u.texts)


def plan(first, next_unit: Callable[[str], Optional[object]], read_kinds: Dict[str, bool], mode: str = "section",
         minutes: float = 6.0, max_units: int = 90) -> Optional[dict]:
    """The stretch of narration that starts at unit `first`: {"units": [{id, kind, chars}], "end", "chars",
    "minutes", "ask", "why"}.  `ask` is False when the stretch is too short to be worth a quiz."""
    if mode not in MODES or mode == "off" or first is None:
        return None
    target = max(2.0, float(minutes)) * CHARS_PER_MINUTE
    units: List[dict] = []
    chars = 0
    u = first
    why = "end"
    while u is not None and len(units) < max_units:
        if readable(u, read_kinds):
            n_chars = len(u.text()) if u.kind in BODY else 0
            units.append({"id": u.id, "kind": u.kind, "chars": n_chars})
            chars += n_chars
        nxt = next_unit(u.id)
        if nxt is None:
            why = "end"
            break
        # never cut right after a heading, or right after a line that introduces a list
        keep_going = u.kind == "heading" or u.text().rstrip().endswith(":")
        cut = None
        if not keep_going and units:
            if mode == "section":
                if nxt.kind == "heading" and chars >= MIN_CHARS:
                    cut = "section"
                elif chars >= CAP_CHARS:
                    cut = "time"
            elif mode == "page":
                if chars >= MIN_CHARS and _last_page(u) < _first_page(nxt):
                    cut = "page"
                elif chars >= CAP_CHARS:
                    cut = "time"
            else:  # minutes
                if nxt.kind == "heading" and chars >= 0.6 * target:
                    cut = "section"
                elif chars >= target:
                    cut = "time"
        if cut:
            why = cut
            break
        u = nxt
    else:
        why = "time"
    if not units:
        return None
    return {"units": units, "end": units[-1]["id"], "chars": chars, "minutes": round(chars / CHARS_PER_MINUTE, 1),
            "ask": chars >= MIN_CHARS, "why": why}
