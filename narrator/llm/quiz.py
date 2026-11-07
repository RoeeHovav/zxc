"""Comprehension checkpoints: questions that test whether the listener really followed what was read.

After a stretch of narration (see narration/checkpoints.py) a language model is asked to write three
multiple-choice questions about exactly the text that was read aloud.  The model is told what makes a question
worth asking (it cannot be answered by common sense, the wrong answers are the mistakes a half-listener makes,
the three questions test different skills), and the app then does not trust it:

* every question must come with a quotation from the text that proves the answer, and the quotation must
  really be in the text (so the question cannot be invented) -- it is also what "hear that part again" jumps to;
* the right answer is placed by the app, not the model (models like to put it in the same slot);
* answers that give themselves away (the correct one much longer than the rest, "all of the above") are dropped.

Uses the same Gemini text models and free allowance as the pronunciation assistant (shared pacing and quota
state).  Questions are cached on disk per passage, so a passage is asked about once.  Needs the Gemini key;
only the text that was just read is sent, never the PDF.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import random
import re
import time
from collections import Counter
from difflib import SequenceMatcher
from typing import Dict, List, Optional, Sequence, Tuple

from ..text.normalize import strip_niqqud, unify_quotes
from .pronounce import PronounceError

log = logging.getLogger(__name__)

QUIZ_VERSION = "q4"
KINDS = ("detail", "link", "apply")
BUDGET = 60.0          # seconds one request may take (the model writes ~1500 tokens)
CANDIDATES = 6        # multiple-choice questions written per passage; the app asks the 2 that are hardest to guess
RECALLS = 3           # open "say it in your own words" questions written; the app asks 1-3 of them
MAX_PASSAGE = 12000    # characters sent at most
EVIDENCE_MATCH = 0.8   # how closely the quotation must match the text

SYSTEM = (
    "You write comprehension checkpoints for a person who is LISTENING to a document read aloud and cannot re-read it. "
    "Right after the stretch ends they answer your questions. The purpose is to find out whether they really followed "
    "what was said, so the questions must be fair but demanding. Questions that can be answered without having heard the "
    "passage -- by common sense, by general knowledge of the subject, or by picking the answer that merely sounds right -- "
    "are the worst possible result.\n\n"
    "Work inside one JSON object.\n"
    "STEP 1 -- \"points\": 5 to 8 short lines (in the passage's language) naming the passage's separate people or positions, "
    "causes, results, steps, definitions and conditions, and what belongs to which.\n"
    "STEP 2 -- \"questions\": exactly 6 candidate multiple-choice questions in the language of the passage (Hebrew passage -> "
    "natural modern Hebrew without vowel marks), about the PASSAGE only, in this order of kinds: detail, detail, link, link, apply, "
    "apply. (The app tests them on someone who did not listen and asks the ones that person finds hardest.)\n"
    "  \"detail\": one specific claim, decision, number, name or condition that matters to the argument and is easy to confuse "
    "with a similar one in the same passage. Not a marginal fact, not something the heading already says.\n"
    "  \"link\": a relationship the passage states or clearly implies -- why something happened, what led to what, how two things "
    "differ, what a rule or action was for, the order of steps.\n"
    "  \"apply\": a NEW situation or statement the listener must judge with the passage's ideas -- which case falls under the "
    "rule or definition given, which statement the author would agree with, what follows from a person's position.\n\n"
    "ASK ABOUT THIS TEXT, NOT ABOUT THE SUBJECT. Prefer what is specific to how THIS passage tells it: its own examples, figures, "
    "names, terms and conditions, the order it gives things in, what it singles out as the first, the main or the decisive reason, "
    "what it says about one person or case but not another. Avoid questions whose answer is the standard textbook fact about the "
    "subject -- anyone who knows the subject can answer those without listening.\n\n"
    "THE DESIGN RULE THAT MATTERS MOST -- build the options from the passage itself. Pick FOUR items of the same type that all "
    "occur in the passage (four people's views, four reasons, four results, four steps, four terms...). The question asks which "
    "ONE belongs to the case you describe. Exactly one fits. The other three are REAL items from the passage that belong to other "
    "cases (another person, another period, another step), or the right item with one decisive element swapped (who / when / why / "
    "direction). Someone who knows the subject but did not hear this passage must not be able to tell the right option from the "
    "others by common sense, by tone or by length. If the passage has fewer than four comparable items, use the ones it has plus a "
    "swapped variant. For one or two of the wrong options you may instead use something that is true or very plausible about the "
    "subject in general but that this passage does NOT say -- then the question must make clear it asks what the TEXT says "
    "(\"according to the text\" / \"לפי הטקסט\"), so that knowing the subject does not help and listening does.\n"
    "Never write wrong options that are generic, dramatic or implausible. Never use absolute or extreme words in ANY option "
    "(only, always, never, completely, entirely, solely, all, none / Hebrew: רק, אך ורק, בלבד, תמיד, לעולם, לחלוטין, מוחלט), and do not "
    "hedge only the right one (\"not entirely\", \"mostly\"). All four options have the same grammatical form, the same kind of claim, "
    "the same level of detail and similar length; the right one is not the longest and not the most careful-sounding. The question "
    "must not contain words that give the right option away.\n\n"
    "Other rules for every question:\n"
    "- Exactly 4 options. options[0] is the ONLY correct one (the app shuffles them afterwards).\n"
    "- Paraphrase; do not copy long stretches. Do not ask about page numbers, formatting, or the heading itself.\n"
    "- Self-contained: no \"the passage above\". You may say \"according to the text\" / \"לפי הטקסט\".\n"
    "- \"evidence\": copy VERBATIM, word for word and in order, 6 to 40 consecutive words from the passage that prove the correct "
    "option. If you cannot find such words, do not write that question.\n"
    "- \"why\": one short sentence in the passage's language explaining the right answer and, if useful, the typical mistake.\n\n"
    "STEP 3 -- \"recall\": exactly 3 open questions that can only be answered from memory of THIS passage (\"explain why...\", "
    "\"what is the difference between X and Y according to the text\", \"what did the author say should happen when...\"), answerable in "
    "one to three sentences. For each give \"key_points\": the 2 to 3 short statements (at most 20 words each) a good answer contains, "
    "and \"evidence\" (verbatim, as above). No options.\n\n"
    "If the passage is not worth testing (a table of contents, a list of references, exercises or questions addressed to the "
    "student, boilerplate, or fewer than about 100 words of real content), return {\"points\": [], \"questions\": [], "
    "\"recall\": [], \"reason\": \"<few words>\"}.\n\n"
    "Return ONLY JSON of this shape: {\"points\": [\"...\"], \"questions\": [{\"kind\": \"detail\", \"q\": \"...\", "
    "\"options\": [\"correct\", \"wrong\", \"wrong\", \"wrong\"], \"evidence\": \"...\", \"why\": \"...\"}, ...], "
    "\"recall\": [{\"q\": \"...\", \"key_points\": [\"...\", \"...\"], \"evidence\": \"...\"}, ...]}"
)

CLOSED_BOOK_SYSTEM = (
    "You are taking a multiple-choice test about a document you have NOT seen (you may be told its title and section). Use general "
    "knowledge and your best judgement; you must pick one option for every question, and say how sure you are: 1 = a pure guess, "
    "2 = a hunch, 3 = fairly likely, 4 = confident, 5 = certain. Reply ONLY with JSON: "
    "{\"answers\": {\"<id>\": {\"pick\": <index of your choice, starting at 0>, \"sure\": <1-5>}, ...}}."
)

LANG_NAMES = {"he": "Hebrew", "en": "English", "ar": "Arabic", "ru": "Russian", "fr": "French", "de": "German",
              "es": "Spanish"}
_GIVEAWAY = re.compile(r"all of the above|none of the above|both of the above|כל התשובות|אף אחת מהתשובות|אף תשובה|כל האמור|שתי התשובות", re.I)
_ABSOLUTE = re.compile(
    r"(?<!\w)(אך ו?רק|רק|בלבד|תמיד|לעולם|לחלוטין|כליל|מוחלט\w*|באופן מוחלט|בשום|אף פעם|ללא יוצא מן הכלל|"
    r"only|always|never|completely|entirely|solely|absolutely|exclusively|none of|nobody|everyone)(?!\w)", re.I)
_SPLIT = re.compile(r"[\s\-־–—/]+")
_NONWORD = re.compile(r"[^\w]", re.UNICODE)


class QuizError(Exception):
    def __init__(self, message: str, quota: bool = False):
        super().__init__(message)
        self.quota = quota


def tokens_of(text: str) -> List[str]:
    """Words for matching: no vowel marks, quotes unified, punctuation and case ignored, hyphenated words split."""
    out: List[str] = []
    for part in _SPLIT.split(unify_quotes(strip_niqqud(text)).lower()):
        part = _NONWORD.sub("", part)
        if part:
            out.append(part)
    return out


class Passage:
    """The text the listener heard, with a way back from a quoted phrase to the word it starts at."""

    def __init__(self, units: Sequence, limit: int = MAX_PASSAGE):
        blocks = []
        for u in units:
            text = " ".join(u.texts).strip()
            if text:
                blocks.append((u, ("## " if u.kind == "heading" else "") + text))
        while len(blocks) > 1 and sum(len(t) + 2 for _, t in blocks) > limit:
            blocks.pop(0)  # keep the most recent text
        self.text = "\n\n".join(t for _, t in blocks)
        self.tokens: List[str] = []
        self.refs: List[Tuple[str, int]] = []
        for u, _ in blocks:
            for wi, w in enumerate(u.texts):
                for tok in tokens_of(w):
                    self.tokens.append(tok)
                    self.refs.append((u.id, wi))
        self.unit_ids = [u.id for u, _ in blocks]

    def locate(self, quote: str) -> Optional[dict]:
        """Where `quote` is in the passage: {"unit", "word", "ratio"} or None.  Tolerates small differences."""
        ev = tokens_of(quote)
        k = len(ev)
        p = self.tokens
        if k < 4 or len(p) < k:
            return None
        best, best_at = 0.0, -1
        starts = set()
        for i, t in enumerate(p):
            for j in range(min(3, k)):
                if t == ev[j]:
                    starts.add(max(0, min(i - j, len(p) - k)))
        for s in sorted(starts):
            r = SequenceMatcher(None, p[s:s + k], ev, autojunk=False).ratio()
            if r > best:
                best, best_at = r, s
                if r == 1.0:
                    break
        if best < EVIDENCE_MATCH and len(p) <= 3000:  # the opening words were reworded: look everywhere
            for s in range(0, len(p) - k + 1):
                r = SequenceMatcher(None, p[s:s + k], ev, autojunk=False).ratio()
                if r > best:
                    best, best_at = r, s
        if best_at < 0 or best < EVIDENCE_MATCH:
            return None
        unit, word = self.refs[best_at]
        return {"unit": unit, "word": word, "ratio": round(best, 2)}


def build_user_message(passage: Passage, lang: str, title: str = "", heading: str = "", asked: Sequence[str] = ()) -> str:
    lines = []
    if title:
        lines.append("Document: " + title)
    if heading:
        lines.append("Section: " + heading)
    lines.append("Language of the passage: %s -- write the points and the questions in this language." % LANG_NAMES.get(lang, lang))
    if asked:
        lines.append("Questions already asked earlier in this document (ask about something else):")
        lines += ["- " + a[:160] for a in list(asked)[-8:]]
    lines.append("PASSAGE:\n<<<\n" + passage.text + "\n>>>")
    return "\n".join(lines)


def _clean(s: object, limit: int) -> str:
    return re.sub(r"\s+", " ", str(s or "")).strip()[:limit]


def _norm_opt(s: str) -> str:
    return " ".join(tokens_of(s))


def _similar(a: str, b: str) -> bool:
    """The same question asked twice, even if reworded or with the clauses in another order."""
    ta, tb = set(tokens_of(a)), set(tokens_of(b))
    if ta and tb and len(ta & tb) / len(ta | tb) >= 0.75:
        return True
    return SequenceMatcher(None, " ".join(tokens_of(a)), " ".join(tokens_of(b))).ratio() > 0.8


def _seed(*parts: str) -> int:
    return int(hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()[:8], 16)


def shuffled(options: List[str], correct: int, salt: str) -> Tuple[List[str], int]:
    """The options in an order chosen by the app (not the model); returns (options, index of the right one)."""
    order = list(range(len(options)))
    random.Random(_seed(salt, options[correct])).shuffle(order)
    return [options[i] for i in order], order.index(correct)


def reshuffle(question: dict, salt: str) -> dict:
    """The same question with the answers in a different order (used when a missed question comes back)."""
    options, answer = shuffled(list(question["options"]), question["answer"], salt)
    return dict(question, options=options, answer=answer)


def validate(reply: object, passage: Passage, want: int = CANDIDATES) -> Tuple[List[dict], Counter]:
    """Keep only the questions that are well formed, grounded in the passage and not self-answering."""
    rejected: Counter = Counter()
    items = reply.get("questions") if isinstance(reply, dict) else None
    out: List[dict] = []
    if not isinstance(items, list):
        return out, rejected
    for pos, item in enumerate(items[:want + 2]):
        if not isinstance(item, dict):
            rejected["malformed"] += 1
            continue
        q = _clean(item.get("q"), 360)
        raw = item.get("options")
        if len(q) < 12 or not isinstance(raw, list) or len(raw) < 4:
            rejected["malformed"] += 1
            continue
        opts = [_clean(o, 260) for o in raw[:4]]
        if any(len(o) < 1 for o in opts) or len({_norm_opt(o) for o in opts}) < 4:
            rejected["options"] += 1
            continue
        if any(_GIVEAWAY.search(o) for o in opts):
            rejected["giveaway-option"] += 1
            continue
        if any(_ABSOLUTE.search(o) for o in opts):
            rejected["absolute-word"] += 1
            continue
        wrong = [len(o) for o in opts[1:]]
        if len(opts[0]) >= 45 and len(opts[0]) > 1.8 * (sum(wrong) / 3.0):
            rejected["correct-answer-stands-out"] += 1
            continue
        loc = passage.locate(_clean(item.get("evidence"), 500))
        if loc is None:
            rejected["evidence-not-in-text"] += 1
            continue
        if any(_similar(q, x["q"]) for x in out):
            rejected["duplicate"] += 1
            continue
        kind = item.get("kind") if item.get("kind") in KINDS else KINDS[min(pos, len(KINDS) - 1)]
        options, answer = shuffled(opts, 0, q)
        out.append({
            "qid": hashlib.sha1((q + "|" + opts[0]).encode("utf-8")).hexdigest()[:12],
            "kind": kind, "q": q, "options": options, "answer": answer,
            "evidence": _clean(item.get("evidence"), 500), "why": _clean(item.get("why"), 400),
            "unit": loc["unit"], "word": loc["word"],
        })
        if len(out) >= want:
            break
    return out, rejected


def validate_recall(reply: object, passage: Passage, want: int = RECALLS) -> Tuple[List[dict], Counter]:
    """Open questions: a question, 2-4 key points a good answer contains, and a quotation that must be in the text."""
    rejected: Counter = Counter()
    items = reply.get("recall") if isinstance(reply, dict) else None
    out: List[dict] = []
    if not isinstance(items, list):
        return out, rejected
    for item in items[:want + 1]:
        if not isinstance(item, dict):
            rejected["recall-malformed"] += 1
            continue
        q = _clean(item.get("q"), 360)
        pts = [_clean(x, 220) for x in item.get("key_points", [])[:4]] if isinstance(item.get("key_points"), list) else []
        pts = [x for x in pts if len(x) >= 3]
        if len(q) < 12 or len(pts) < 2:
            rejected["recall-malformed"] += 1
            continue
        loc = passage.locate(_clean(item.get("evidence"), 500))
        if loc is None:
            rejected["recall-evidence-not-in-text"] += 1
            continue
        out.append({"qid": hashlib.sha1((q + "|recall").encode("utf-8")).hexdigest()[:12], "kind": "recall", "q": q,
                    "key_points": pts, "evidence": _clean(item.get("evidence"), 500), "unit": loc["unit"], "word": loc["word"]})
        if len(out) >= want:
            break
    return out, rejected


def closed_book_message(questions: List[dict], title: str = "", heading: str = "") -> str:
    head = []
    if title:
        head.append("Document: " + title)
    if heading:
        head.append("Section: " + heading)
    body = "\n".join("[%d] %s\n%s" % (i, q["q"], "\n".join("  %d. %s" % (j, o) for j, o in enumerate(q["options"])))
                     for i, q in enumerate(questions))
    return "\n".join(head + ["QUESTIONS:", body])


def read_guess(value: object) -> Tuple[Optional[int], int]:
    """(chosen index, how sure 1-5) from one entry of the closed-book answer."""
    if isinstance(value, dict):
        pick, sure = value.get("pick"), value.get("sure")
    else:
        pick, sure = value, 3
    pick = pick if isinstance(pick, int) and not isinstance(pick, bool) else None
    sure = sure if isinstance(sure, int) and 1 <= sure <= 5 else 3
    return pick, sure


async def guess_without_passage(ask, questions: List[dict], title: str = "", heading: str = "") -> List[Tuple[bool, int]]:
    """For each question: would someone who did NOT hear the passage pick the right answer, and how sure would they be?
    (One request.)"""
    reply = await ask(CLOSED_BOOK_SYSTEM, closed_book_message(questions, title, heading), 0.0)
    answers = reply.get("answers", {}) if isinstance(reply, dict) else {}
    out = []
    for i, q in enumerate(questions):
        pick, sure = read_guess(answers.get(str(i)) if isinstance(answers, dict) else None)
        out.append((pick == q["answer"], sure))
    return out


STYLES = ("mixed", "recall", "choice")


def assemble(result: dict, style: str = "mixed", total: int = 3) -> List[dict]:
    """The questions to put to the listener, from what was written: "mixed" = the two multiple-choice questions that are
    hardest to guess and one open question; "recall" = open questions only (cannot be guessed at all); "choice" =
    multiple choice only.  If one kind runs short the other fills up."""
    choice, recall = list(result.get("choice", [])), list(result.get("recall", []))
    if style == "recall":
        picked = recall[:total] + choice[:max(0, min(total, 2) - len(recall))]
    elif style == "choice":
        picked = choice[:total] + recall[:max(0, min(total, 2) - len(choice))]
    else:
        picked = choice[:2] + recall[:1]
        if len(picked) < total:
            picked += (recall[1:] + choice[2:])[:total - len(picked)]
    mc = sorted([q for q in picked if q["kind"] != "recall"], key=lambda q: KINDS.index(q["kind"]))
    return mc + [q for q in picked if q["kind"] == "recall"]


def select(candidates: List[dict], guesses: Sequence[Tuple[bool, int]], want: int = 3) -> List[dict]:
    """The multiple-choice questions to ask: the ones a person who had NOT listened finds hardest -- picked wrongly first,
    then picked right only on a hunch, then picked right with confidence -- with different kinds where possible."""
    ranked = sorted(zip(candidates, guesses), key=lambda t: (t[1][0], t[1][1]))  # wrong first, then the least sure
    chosen: List[dict] = []
    for c, _g in ranked:
        if len(chosen) < want and all(c["kind"] != x["kind"] for x in chosen):
            chosen.append(c)
    for c, _g in ranked:
        if len(chosen) < want and c not in chosen:
            chosen.append(c)
    return sorted(chosen, key=lambda c: KINDS.index(c["kind"]))


async def build(ask, passage: Passage, lang: str, title: str = "", heading: str = "", asked: Sequence[str] = (),
                verify: bool = True) -> dict:
    """The whole recipe.  `ask(system, user, temperature)` returns parsed JSON.
    -> {"questions", "reason", "points", "rejected", "candidates", "guessable", "verified", "requests"}
    "choice" = up to three multiple-choice questions, hardest to guess first; "recall" = open questions;
    "questions" = the usual mix of them (see assemble)."""
    user = build_user_message(passage, lang, title, heading, asked)
    rejected: Counter = Counter()
    requests = 0
    reply: object = None
    candidates: List[dict] = []
    recalls: List[dict] = []
    asked_any = False
    for attempt in range(2):
        reply = await ask(SYSTEM, user, 0.3)
        requests += 1
        candidates, rej = validate(reply, passage)
        recalls, rej2 = validate_recall(reply, passage)
        rejected.update(rej)
        rejected.update(rej2)
        asked_any = isinstance(reply, dict) and bool(reply.get("questions") or reply.get("recall"))
        if candidates or recalls or not asked_any:
            break  # something usable, or the model said there is nothing worth asking
    out = {"questions": [], "reason": "", "points": [], "rejected": dict(rejected), "candidates": len(candidates),
           "guessable": 0, "verified": False, "requests": requests}
    if isinstance(reply, dict) and isinstance(reply.get("points"), list):
        out["points"] = [_clean(p, 200) for p in reply["points"][:8]]
    if not candidates and not recalls:
        if asked_any:
            detail = ", ".join(sorted(rejected)) or "unusable"
            raise QuizError("the questions it wrote could not be checked against the text (%s)" % detail)
        out["reason"] = _clean(reply.get("reason") if isinstance(reply, dict) else "", 120) or "nothing to ask about"
        return out
    guessed: List[Tuple[bool, int]] = [(False, 3)] * len(candidates)
    if verify and candidates:
        try:
            guessed = await guess_without_passage(ask, candidates, title, heading)
            requests += 1
            out["verified"] = True
        except (QuizError, PronounceError) as exc:  # no allowance left for the check: ask the unchecked questions
            log.info("quiz: could not check the questions for guessability: %s", exc)
    out["guessable"] = sum(1 for r, s_ in guessed if r and s_ > 3)
    out["requests"] = requests
    out["_candidates"] = candidates  # for the evaluation script; not stored
    out["choice"] = select(candidates, guessed) if out["verified"] else candidates[:3]
    out["recall"] = recalls[:RECALLS]
    out["questions"] = assemble(out, "mixed")
    return out


class QuizMaker:
    """Asks the Gemini text model for a checkpoint, with a disk cache and one job per passage."""

    def __init__(self, asker, cache_dir: str):
        self.asker = asker  # a Vocalizer: shares the key, the models, the pacing and the free-allowance state
        self.cache_dir = cache_dir
        os.makedirs(cache_dir, exist_ok=True)
        self._inflight: Dict[str, asyncio.Future] = {}
        self.stats: Counter = Counter()

    def key(self, passage: Passage, lang: str) -> str:
        return hashlib.sha256(("%s|%s|%s" % (QUIZ_VERSION, lang, passage.text)).encode("utf-8")).hexdigest()[:40]

    def _path(self, key: str) -> str:
        return os.path.join(self.cache_dir, key + ".json")

    def cached(self, key: str) -> Optional[dict]:
        try:
            with open(self._path(key), encoding="utf-8") as fh:
                return json.load(fh)
        except (OSError, ValueError):
            return None

    def start(self, passage: Passage, lang: str, title: str = "", heading: str = "", asked: Sequence[str] = ()) -> asyncio.Future:
        """Begin (or join) the job for this passage; nothing is awaited here."""
        key = self.key(passage, lang)
        fut = self._inflight.get(key)
        if fut is None:
            fut = asyncio.ensure_future(self._generate(key, passage, lang, title, heading, list(asked)))
            self._inflight[key] = fut

            def done(f: asyncio.Future, k: str = key) -> None:
                self._inflight.pop(k, None)
                if not f.cancelled():
                    f.exception()  # a failed prefetch is not an unhandled error

            fut.add_done_callback(done)
        return fut

    async def make(self, passage: Passage, lang: str, title: str = "", heading: str = "", asked: Sequence[str] = ()) -> dict:
        hit = self.cached(self.key(passage, lang))
        if hit is not None:
            self.stats["cached"] += 1
            return hit
        return await asyncio.shield(self.start(passage, lang, title, heading, asked))

    def ready(self, passage: Passage, lang: str) -> bool:
        return self.cached(self.key(passage, lang)) is not None

    async def _ask(self, system: str, user: str, temperature: float) -> object:
        try:
            return await self.asker.ask_json(system, user, budget=BUDGET, temperature=temperature)
        except PronounceError as exc:
            raise QuizError(str(exc), quota=exc.quota) from exc

    async def _generate(self, key: str, passage: Passage, lang: str, title: str, heading: str, asked: List[str]) -> dict:
        if not getattr(self.asker, "key", None):
            raise QuizError("no Gemini key")
        if time.time() < getattr(self.asker, "cooldown_until", 0.0):
            raise QuizError(getattr(self.asker, "cool_message", "") or "cooling down", quota=bool(getattr(self.asker, "cool_quota", False)))
        result = await build(self._ask, passage, lang, title, heading, asked)
        result.pop("_candidates", None)
        result.pop("questions", None)  # assembled when asked, because the style is a setting
        self.stats["asked"] += result["requests"]
        result.update(key=key, model=getattr(self.asker, "working_model", None), version=QUIZ_VERSION)
        try:
            with open(self._path(key), "w", encoding="utf-8") as fh:
                json.dump(result, fh, ensure_ascii=False)
        except OSError:
            pass
        return result
