"""Teacher Mode: AI explanations that are clearly separate from the document.

The model receives the passage plus its surrounding context (document title,
section heading, previous paragraph) and must explain -- never rewrite -- it.
Explanations are cached so replaying a section costs nothing.
"""
from __future__ import annotations

import hashlib
import json
import os
from typing import List, Optional

from .client import LLMClient

SYSTEM = {
    "he": (
        "אתה מורה סבלני ובקיא שמסביר לסטודנט חומר לימוד שהוא שומע בהקראה. "
        "הסבר את הקטע שיסומן במילים פשוטות וברורות, כפי שמורה היה מסביר בעל פה: "
        "מה הרעיון המרכזי, מה פירוש מונחים קשים או ראשי תיבות, ולמה זה חשוב. "
        "אל תחזור על הקטע מילה במילה ואל תמציא עובדות שאינן נתמכות בקטע; אם משהו אינו ודאי, אמור זאת. "
        "כתוב 3 עד 6 משפטים בעברית תקנית, טקסט רציף להקראה בלבד – בלי כותרות, רשימות או סימני עיצוב."
    ),
    "en": (
        "You are a patient, knowledgeable teacher helping a student who is listening to study material read aloud. "
        "Explain the marked passage in simple, clear spoken language, the way a teacher would out loud: the main idea, "
        "the meaning of difficult terms, abbreviations or equations, and why it matters. Do not repeat the passage "
        "verbatim and do not invent facts that the passage does not support; say so if something is uncertain. "
        "Write 3 to 6 sentences of plain prose meant to be spoken - no headings, lists or markdown."
    ),
}


def build_messages(lang: str, title: str, heading: str, previous: str, passage: str) -> List[dict]:
    he = lang == "he"
    ctx = []
    if title:
        ctx.append(("שם המסמך: " if he else "Document: ") + title)
    if heading:
        ctx.append(("פרק/סעיף: " if he else "Section: ") + heading)
    if previous:
        ctx.append(("הקטע הקודם (להקשר בלבד): " if he else "Previous paragraph (context only): ") + previous[-1200:])
    ctx.append(("הקטע להסבר:\n" if he else "Passage to explain:\n") + "<<<\n" + passage[:4000] + "\n>>>")
    lang_key = "he" if he else "en"
    sys = SYSTEM[lang_key] if lang in ("he", "en") else SYSTEM["en"] + f" Answer in the language with ISO code '{lang}'."
    return [{"role": "system", "content": sys}, {"role": "user", "content": "\n\n".join(ctx)}]


class ExplanationCache:
    def __init__(self, root: str):
        self.root = root
        os.makedirs(root, exist_ok=True)

    def key(self, model: str, messages: List[dict]) -> str:
        return hashlib.sha256(json.dumps([model, messages], ensure_ascii=False).encode()).hexdigest()[:32]

    def get(self, key: str) -> Optional[str]:
        p = os.path.join(self.root, key + ".txt")
        if os.path.exists(p):
            with open(p, encoding="utf-8") as fh:
                return fh.read()
        return None

    def put(self, key: str, text: str) -> None:
        with open(os.path.join(self.root, key + ".txt"), "w", encoding="utf-8") as fh:
            fh.write(text)


async def explain(client: LLMClient, cache: ExplanationCache, lang: str, title: str, heading: str, previous: str, passage: str) -> str:
    messages = build_messages(lang, title, heading, previous, passage)
    key = cache.key(client.model, messages)
    hit = cache.get(key)
    if hit:
        return hit
    text = await client.chat(messages)
    cache.put(key, text)
    return text
