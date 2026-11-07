"""Paths and default settings."""
from __future__ import annotations

import copy
import os
import sys

APP_NAME = "PDF Narrator"
VERSION = "0.11.1"


def data_dir() -> str:
    env = os.environ.get("NARRATOR_DATA_DIR")
    if env:
        path = env
    elif sys.platform == "win32":
        path = os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "PDFNarrator")
    elif sys.platform == "darwin":
        path = os.path.expanduser("~/Library/Application Support/PDFNarrator")
    else:
        path = os.path.join(os.environ.get("XDG_DATA_HOME", os.path.expanduser("~/.local/share")), "pdf-narrator")
    os.makedirs(path, exist_ok=True)
    return path


def test_mode() -> bool:
    return os.environ.get("NARRATOR_TEST_MODE") == "1"


DEFAULT_SETTINGS = {
    # voice per language (provider:voice).  Other languages fall back to the
    # first voice of the active provider that matches the language.
    "voices": {
        "he": "edge:he-IL-HilaNeural",
        "en": "edge:en-US-AvaMultilingualNeural",
    },
    "provider": "edge",
    "speed": 1.0,
    "pause_scale": 1.0,
    "skip_seconds": 10,
    "read_kinds": {
        "heading": True, "paragraph": True, "list_item": True, "note": True, "caption": True, "footnote": True,
        "header": False, "footer": False, "page_number": False, "toc": False, "figure_text": False, "artifact": False,
    },
    "auto_scroll": True,
    "highlight": "word",  # word | sentence
    "switch_voice_for_foreign": True,
    "max_chunk_chars": 900,
    "skip_citations": True,
    "skip_footnote_marks": True,
    "verbalize_math": True,
    "theme": "system",
    "ui_lang": "auto",
    "zoom": 1.25,
    "cloud_consent": {},  # provider id -> timestamp of consent
    "azure_region": "",
    "gemini_model": "",  # empty = discover the best available Gemini TTS model
    "prefetch_chunks": 3,
    # Before the first play, narrate this much of the remaining document (0 = start at once);
    # the rest keeps being prepared in the background while it plays.
    "buffer_percent": 50,
    "buffer_minutes": 10,  # ...but never wait for more than about this many minutes of narration (0 = no cap)
    # When a limited online voice (e.g. Gemini free tier) runs out, continue with the free voice.
    "free_fallback": True,
    # Vowel marks for every Hebrew word from Dicta's free Nakdan service (no key; text only; asks consent first).
    "nakdan": True,
    # Pronunciation assistant: a language model reads each Hebrew passage and adds vowel marks to
    # the words that can be read several ways (שמן, ספר, ...).  Needs the Gemini key; text only.
    "ai_pronunciation": True,
    "pronunciation_model": "",
    # Comprehension checkpoints: after a stretch of listening, three questions about what was just read.
    # Needs the Gemini key (text only is sent).  quiz_mode: off | section | page | minutes.
    "quiz_mode": "off",
    "quiz_minutes": 6,
    "quiz_style": "mixed",  # mixed (2 choice + 1 open) | recall (open questions only: cannot be guessed) | choice
    "quiz_read_aloud": False,
    # Teacher Mode (optional, off by default): any OpenAI-compatible endpoint.
    # The default points at a free local Ollama installation.
    "teacher_mode": False,
    "llm_base_url": "http://127.0.0.1:11434/v1",
    "llm_model": "",
    "sleep_minutes": 0,
}

SECRET_KEYS = {"azure_key", "llm_api_key", "gemini_api_key"}


def default_settings() -> dict:
    return copy.deepcopy(DEFAULT_SETTINGS)
