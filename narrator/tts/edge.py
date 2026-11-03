"""Free Microsoft neural voices through the Edge "Read Aloud" service.

Uses the maintained ``edge-tts`` library.  No account or key is needed, word
boundaries (exact per-word timing) are returned, and quality equals Azure's
neural voices (he-IL-HilaNeural / he-IL-AvriNeural for Hebrew, the "Multilingual"
English voices, and 100+ other locales).

Caveats (shown in the UI): it is an unofficial endpoint that Microsoft could
change, text is sent to Microsoft for synthesis, and SSML (custom pauses,
phonemes) is not accepted -- pronunciation guidance is therefore given through
the text itself (niqqud, respellings, expansions).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from typing import List, Optional

from ..narration.align import Boundary
from .base import ProviderInfo, SynthResult, TTSError, TTSProvider, Voice

log = logging.getLogger(__name__)

# Voices known to exist on the service, used until the live list is fetched.
FALLBACK_VOICES = [
    ("he-IL-HilaNeural", "Hila", "he-IL", "Female"),
    ("he-IL-AvriNeural", "Avri", "he-IL", "Male"),
    ("en-US-AvaMultilingualNeural", "Ava (Multilingual)", "en-US", "Female"),
    ("en-US-AndrewMultilingualNeural", "Andrew (Multilingual)", "en-US", "Male"),
    ("en-US-EmmaMultilingualNeural", "Emma (Multilingual)", "en-US", "Female"),
    ("en-US-BrianMultilingualNeural", "Brian (Multilingual)", "en-US", "Male"),
    ("en-US-AriaNeural", "Aria", "en-US", "Female"),
    ("en-US-JennyNeural", "Jenny", "en-US", "Female"),
    ("en-US-GuyNeural", "Guy", "en-US", "Male"),
    ("en-GB-SoniaNeural", "Sonia", "en-GB", "Female"),
    ("en-GB-RyanNeural", "Ryan", "en-GB", "Male"),
    ("en-AU-NatashaNeural", "Natasha", "en-AU", "Female"),
    ("en-AU-WilliamNeural", "William", "en-AU", "Male"),
    ("en-IN-NeerjaNeural", "Neerja", "en-IN", "Female"),
    ("en-IE-EmilyNeural", "Emily", "en-IE", "Female"),
    ("fr-FR-DeniseNeural", "Denise", "fr-FR", "Female"),
    ("fr-FR-HenriNeural", "Henri", "fr-FR", "Male"),
    ("de-DE-KatjaNeural", "Katja", "de-DE", "Female"),
    ("de-DE-ConradNeural", "Conrad", "de-DE", "Male"),
    ("es-ES-ElviraNeural", "Elvira", "es-ES", "Female"),
    ("es-MX-DaliaNeural", "Dalia", "es-MX", "Female"),
    ("it-IT-ElsaNeural", "Elsa", "it-IT", "Female"),
    ("it-IT-DiegoNeural", "Diego", "it-IT", "Male"),
    ("pt-BR-FranciscaNeural", "Francisca", "pt-BR", "Female"),
    ("ru-RU-SvetlanaNeural", "Svetlana", "ru-RU", "Female"),
    ("ru-RU-DmitryNeural", "Dmitry", "ru-RU", "Male"),
    ("ar-SA-ZariyahNeural", "Zariyah", "ar-SA", "Female"),
    ("ar-SA-HamedNeural", "Hamed", "ar-SA", "Male"),
    ("nl-NL-ColetteNeural", "Colette", "nl-NL", "Female"),
    ("pl-PL-ZofiaNeural", "Zofia", "pl-PL", "Female"),
    ("tr-TR-EmelNeural", "Emel", "tr-TR", "Female"),
    ("uk-UA-PolinaNeural", "Polina", "uk-UA", "Female"),
    ("el-GR-AthinaNeural", "Athina", "el-GR", "Female"),
    ("hi-IN-SwaraNeural", "Swara", "hi-IN", "Female"),
    ("ja-JP-NanamiNeural", "Nanami", "ja-JP", "Female"),
    ("zh-CN-XiaoxiaoNeural", "Xiaoxiao", "zh-CN", "Female"),
    ("ko-KR-SunHiNeural", "SunHi", "ko-KR", "Female"),
]

TICKS = 10_000_000


class EdgeProvider(TTSProvider):
    info = ProviderInfo(
        id="edge",
        name="Microsoft neural voices (free, online)",
        free=True,
        cloud=True,
        requires_key=False,
        word_timing=True,
        privacy="The text being read is sent to Microsoft's speech service. No account is used.",
        verified="Integration code and timing alignment are unit-tested; live synthesis could not be reached from the "
                 "development environment (network policy) and must be confirmed on the user's machine.",
    )

    def __init__(self, cache_dir: Optional[str] = None):
        self.cache_dir = cache_dir
        self._voices: Optional[List[Voice]] = None
        self._voices_time = 0.0

    def available(self) -> tuple:
        try:
            import edge_tts  # noqa: F401
        except Exception:
            return False, "The 'edge-tts' package is not installed."
        return True, ""

    @property
    def version(self) -> str:
        try:
            import edge_tts
            return "edge-" + edge_tts.__version__.split(".")[0]
        except Exception:
            return "edge"

    def _voice_cache_path(self) -> Optional[str]:
        return os.path.join(self.cache_dir, "edge_voices.json") if self.cache_dir else None

    async def list_voices(self) -> List[Voice]:
        if self._voices is not None and time.time() - self._voices_time < 24 * 3600:
            return self._voices
        path = self._voice_cache_path()
        raw = None
        try:
            import edge_tts
            raw = await asyncio.wait_for(edge_tts.list_voices(proxy=_proxy()), timeout=12)
            if path and raw:
                with open(path, "w", encoding="utf-8") as fh:
                    json.dump(raw, fh)
        except Exception as exc:
            log.info("edge voice list unavailable (%s); using cached/fallback list", exc)
            if path and os.path.exists(path):
                try:
                    with open(path, encoding="utf-8") as fh:
                        raw = json.load(fh)
                except Exception:
                    raw = None
        voices: List[Voice] = []
        if raw:
            for v in raw:
                short = v.get("ShortName")
                if not short:
                    continue
                friendly = v.get("FriendlyName", short)
                name = short.split("-", 2)[-1].replace("Neural", "")
                voices.append(Voice(id=f"edge:{short}", provider="edge", name=name, locale=v.get("Locale", ""),
                                    gender=v.get("Gender", ""), description=friendly))
        else:
            voices = [Voice(id=f"edge:{s}", provider="edge", name=n, locale=l, gender=g) for s, n, l, g in FALLBACK_VOICES]
        self._voices = voices
        self._voices_time = time.time()
        return voices

    async def synthesize(self, text: str, voice: str, lang: str, rate: int = 0, pitch: int = 0) -> SynthResult:
        try:
            import edge_tts
        except Exception as exc:  # pragma: no cover
            raise TTSError("edge-tts is not installed", retryable=False) from exc
        short = voice.split(":", 1)[-1]
        rate_s = f"{'+' if rate >= 0 else ''}{int(rate)}%"
        pitch_s = f"{'+' if pitch >= 0 else ''}{int(pitch)}Hz"
        last_exc: Optional[Exception] = None
        for attempt in range(3):
            try:
                return await asyncio.wait_for(self._once(edge_tts, text, short, rate_s, pitch_s), timeout=90)
            except TTSError:
                raise
            except Exception as exc:  # network hiccups, throttling
                last_exc = exc
                log.warning("edge synthesis attempt %s failed: %s", attempt + 1, exc)
                await asyncio.sleep(0.8 * (2 ** attempt))
        raise TTSError(f"Could not reach Microsoft's speech service: {last_exc}")

    async def _once(self, edge_tts, text: str, short: str, rate_s: str, pitch_s: str) -> SynthResult:
        com = edge_tts.Communicate(text, short, rate=rate_s, pitch=pitch_s, boundary="WordBoundary", proxy=_proxy())
        audio = bytearray()
        bounds: List[Boundary] = []
        async for msg in com.stream():
            t = msg.get("type")
            if t == "audio":
                audio.extend(msg["data"])
            elif t == "WordBoundary":
                bounds.append(Boundary(start=msg["offset"] / TICKS, duration=msg["duration"] / TICKS, text=msg["text"]))
        if not audio:
            raise TTSError("The speech service returned no audio.")
        # output format is 24 kHz 48 kbit/s CBR MP3
        duration = len(audio) * 8 / 48000
        if bounds:
            duration = max(duration, bounds[-1].start + bounds[-1].duration)
        return SynthResult(audio=bytes(audio), ext="mp3", mime="audio/mpeg", duration=duration, boundaries=bounds)


def _proxy() -> Optional[str]:
    return os.environ.get("NARRATOR_PROXY") or None
