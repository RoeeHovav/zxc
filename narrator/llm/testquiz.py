"""A pretend question writer for tests and the end-to-end check (NARRATOR_TEST_MODE=1): no network, no key.

It writes questions about whatever passage it is given -- the quoted evidence is a real stretch of that passage --
so the whole checkpoint flow (planning, asking, answering, replaying the answer, scoring) can be exercised."""
from __future__ import annotations

import re


class TestQuizModel:
    __test__ = False  # not a pytest class
    key = "test"
    cooldown_until = 0.0
    working_model = "test-model"
    cool_message = ""
    cool_quota = False

    def __init__(self) -> None:
        self.calls = 0

    async def ask_json(self, system: str, user: str, budget: float = 0, temperature: float = 0) -> object:
        self.calls += 1
        if "QUESTIONS:" in user and "<<<" not in user:  # the "could you guess it without the text" check
            return {"answers": {}}
        text = user.split("<<<", 1)[1].split(">>>")[0]
        words = [w for w in re.sub(r"[#\n]", " ", text).split() if w]
        ev = " ".join(words[3:15])
        opts = [" ".join(words[i:i + 4]) for i in (3, 20, 30, 40)]
        tag = len(text)  # different stretches get different questions

        names = ["", "ראשונה", "שנייה", "שלישית", "רביעית"]

        def mc(kind: str, n: int) -> dict:
            about = " ".join(words[n * 5:n * 5 + 3]) or "הקטע"  # each question is about different words, so none is a duplicate
            return {"kind": kind, "q": f"שאלה {names[n]} על קטע {tag}: מה נאמר לפי הטקסט על {about} בקטע שהושמע זה עתה?",
                    "options": [o + f" {n}{tag}" for o in opts], "evidence": ev, "why": "כי כך נאמר בקטע."}
        return {"points": ["p"], "questions": [mc("detail", 1), mc("detail", 2), mc("link", 3), mc("apply", 4)],
                "recall": [{"q": f"{names[i]}: הסבר במילותיך מה נאמר על {' '.join(words[i * 7:i * 7 + 3]) or 'הקטע'} בקטע זה לפי הטקסט?",
                            "key_points": ["נקודה ראשונה", "נקודה שנייה"], "evidence": ev} for i in (1, 2, 3)]}
