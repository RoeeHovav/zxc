"""Deterministic offline engine used ONLY by automated tests.

It renders each word as a short tone with exactly known timing, so playback,
seeking and highlight synchronisation can be verified end-to-end without a
network.  It is never offered to users (enabled only when NARRATOR_TEST_MODE=1).
"""
from __future__ import annotations

import io
import math
import struct
import wave
from typing import List

from ..narration.align import Boundary
from .base import ProviderInfo, SynthResult, TTSProvider, Voice

RATE = 16000


class TestToneProvider(TTSProvider):
    info = ProviderInfo(
        id="testtone", name="Test tones (automated tests only)", free=True, cloud=False, requires_key=False,
        word_timing=True, privacy="Offline.", verified="Used by the automated test-suite.",
    )

    async def list_voices(self) -> List[Voice]:
        return [Voice(id="testtone:low", provider="testtone", name="Low tone", locale="he-IL"),
                Voice(id="testtone:high", provider="testtone", name="High tone", locale="en-US")]

    async def synthesize(self, text: str, voice: str, lang: str, rate: int = 0, pitch: int = 0) -> SynthResult:
        words = text.split()
        freq = 330 if voice.endswith("low") else 523
        speed = 1.0 + rate / 100.0
        samples: List[int] = []
        bounds: List[Boundary] = []
        lead = int(0.05 * RATE)
        samples += [0] * lead
        pos = text.find
        cursor = 0
        for w in words:
            dur = max(0.12, 0.045 * len(w)) / speed
            n = int(dur * RATE)
            start = len(samples) / RATE
            off = text.find(w, cursor)
            cursor = off + len(w) if off >= 0 else cursor
            bounds.append(Boundary(start=start, duration=dur, text=w, char_offset=off if off >= 0 else None))
            for k in range(n):
                env = min(1.0, k / 200, (n - k) / 200)
                samples.append(int(6000 * env * math.sin(2 * math.pi * freq * k / RATE)))
            samples += [0] * int(0.04 * RATE)
        samples += [0] * lead
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(RATE)
            wf.writeframes(struct.pack(f"<{len(samples)}h", *samples))
        return SynthResult(audio=buf.getvalue(), ext="wav", mime="audio/wav", duration=len(samples) / RATE, boundaries=bounds)
