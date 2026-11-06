"""Speech provider interface."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional

from ..narration.align import Boundary


class TTSError(Exception):
    """A synthesis failure that should be shown to the user."""

    def __init__(self, message: str, retryable: bool = True):
        super().__init__(message)
        self.retryable = retryable


@dataclass
class Voice:
    id: str  # provider-qualified "edge:he-IL-HilaNeural"
    provider: str
    name: str
    locale: str
    gender: str = ""
    description: str = ""

    @property
    def lang(self) -> str:
        return self.locale.split("-")[0].lower()

    def to_json(self) -> dict:
        return {"id": self.id, "provider": self.provider, "name": self.name, "locale": self.locale,
                "gender": self.gender, "lang": self.lang, "description": self.description}


@dataclass
class SynthResult:
    audio: bytes
    ext: str  # "mp3" | "wav"
    mime: str
    duration: float
    boundaries: List[Boundary] = field(default_factory=list)


@dataclass
class ProviderInfo:
    id: str
    name: str
    free: bool
    cloud: bool
    requires_key: bool
    word_timing: bool
    privacy: str
    verified: str  # honest statement of what has been tested


class TTSProvider:
    info: ProviderInfo
    prefetch_limit: Optional[int] = None  # cap on look-ahead synthesis for rate-limited engines

    def configure(self, settings: dict) -> None:
        """Receive (possibly secret) settings such as API keys."""

    def status(self) -> dict:
        ok, reason = self.available()
        return {"available": ok, "reason": reason}

    def available(self) -> tuple:
        return True, ""

    async def list_voices(self) -> List[Voice]:
        raise NotImplementedError

    async def synthesize(self, text: str, voice: str, lang: str, rate: int = 0, pitch: int = 0) -> SynthResult:
        raise NotImplementedError

    @property
    def version(self) -> str:
        return "1"
