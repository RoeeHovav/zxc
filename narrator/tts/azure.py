"""Azure AI Speech (official API).  Same neural voices as the free Edge
service, but with an SLA, full SSML (pauses, prosody, phoneme/lexicon support)
and a free tier (F0: 0.5 M characters per month at the time of writing).

Requires the optional package ``azure-cognitiveservices-speech`` and a key +
region entered in Settings.  Not exercised against the live service during
development (no key, network policy) -- treat as unverified until tested.
"""
from __future__ import annotations

import asyncio
import html
import logging
from typing import List, Optional

from ..narration.align import Boundary
from .base import ProviderInfo, SynthResult, TTSError, TTSProvider, Voice
from .edge import FALLBACK_VOICES

log = logging.getLogger(__name__)


class AzureProvider(TTSProvider):
    info = ProviderInfo(
        id="azure",
        name="Azure AI Speech (your key; free tier available)",
        free=False,
        cloud=True,
        requires_key=True,
        word_timing=True,
        privacy="The text being read is sent to Microsoft Azure under your own subscription.",
        verified="Implemented against the documented Speech SDK API but NOT tested against the live service.",
    )

    def __init__(self):
        self.key: Optional[str] = None
        self.region: Optional[str] = None

    def configure(self, settings: dict) -> None:
        self.key = (settings.get("azure_key") or "").strip() or None
        self.region = (settings.get("azure_region") or "").strip() or None

    def available(self) -> tuple:
        try:
            import azure.cognitiveservices.speech  # noqa: F401
        except Exception:
            return False, "Install the optional package: pip install azure-cognitiveservices-speech"
        if not self.key or not self.region:
            return False, "Enter an Azure Speech key and region in Settings."
        return True, ""

    async def list_voices(self) -> List[Voice]:
        return [Voice(id=f"azure:{s}", provider="azure", name=n, locale=l, gender=g) for s, n, l, g in FALLBACK_VOICES]

    async def synthesize(self, text: str, voice: str, lang: str, rate: int = 0, pitch: int = 0) -> SynthResult:
        ok, reason = self.available()
        if not ok:
            raise TTSError(reason, retryable=False)
        return await asyncio.get_running_loop().run_in_executor(None, self._sync, text, voice, rate, pitch)

    def _sync(self, text: str, voice: str, rate: int, pitch: int) -> SynthResult:
        import azure.cognitiveservices.speech as speechsdk

        short = voice.split(":", 1)[-1]
        locale = "-".join(short.split("-")[:2])
        cfg = speechsdk.SpeechConfig(subscription=self.key, region=self.region)
        cfg.set_speech_synthesis_output_format(speechsdk.SpeechSynthesisOutputFormat.Audio24Khz48KBitRateMonoMp3)
        synth = speechsdk.SpeechSynthesizer(speech_config=cfg, audio_config=None)
        bounds: List[Boundary] = []

        def on_word(evt):
            if str(getattr(evt, "boundary_type", "")).endswith("Word"):
                bounds.append(Boundary(start=evt.audio_offset / 10_000_000, duration=evt.duration.total_seconds(), text=evt.text))

        synth.synthesis_word_boundary.connect(on_word)
        ssml = (
            f"<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='{locale}'>"
            f"<voice name='{short}'><prosody rate='{rate:+d}%' pitch='{pitch:+d}Hz'>{html.escape(text, quote=False)}</prosody></voice></speak>"
        )
        result = synth.speak_ssml_async(ssml).get()
        if result.reason != speechsdk.ResultReason.SynthesizingAudioCompleted:
            details = getattr(result, "cancellation_details", None)
            msg = getattr(details, "error_details", None) or str(result.reason)
            raise TTSError(f"Azure synthesis failed: {msg}")
        audio = bytes(result.audio_data)
        duration = result.audio_duration.total_seconds() if getattr(result, "audio_duration", None) else len(audio) * 8 / 48000
        return SynthResult(audio=audio, ext="mp3", mime="audio/mpeg", duration=duration, boundaries=bounds)
