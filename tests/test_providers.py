import asyncio
import sys
import types

import pytest

from narrator.tts.base import TTSError
from narrator.tts.edge import EdgeProvider


class FakeCommunicate:
    calls = []
    fail_times = 0

    def __init__(self, text, voice, **kw):
        FakeCommunicate.calls.append((text, voice, kw))
        self.text = text

    async def stream(self):
        if FakeCommunicate.fail_times > 0:
            FakeCommunicate.fail_times -= 1
            raise ConnectionError("network down")
        t = 1_000_000
        for w in self.text.split():
            yield {"type": "WordBoundary", "offset": t, "duration": 2_000_000, "text": w}
            t += 3_000_000
        yield {"type": "audio", "data": b"\xff" * 6000}


@pytest.fixture
def fake_edge(monkeypatch):
    mod = types.ModuleType("edge_tts")
    mod.Communicate = FakeCommunicate
    mod.__version__ = "7.0.0"
    monkeypatch.setitem(sys.modules, "edge_tts", mod)
    FakeCommunicate.calls = []
    FakeCommunicate.fail_times = 0
    monkeypatch.setattr(asyncio, "sleep", _nosleep)
    return mod


async def _nosleep(*a, **k):
    return None


def test_edge_parses_word_boundaries(fake_edge):
    res = asyncio.run(EdgeProvider().synthesize("שלום עולם יפה", "edge:he-IL-HilaNeural", "he", rate=-6))
    assert res.ext == "mp3"
    assert [b.text for b in res.boundaries] == ["שלום", "עולם", "יפה"]
    assert res.boundaries[1].start == pytest.approx(0.4)
    assert res.boundaries[0].duration == pytest.approx(0.2)
    text, voice, kw = FakeCommunicate.calls[0]
    assert voice == "he-IL-HilaNeural" and kw["rate"] == "-6%" and kw["boundary"] == "WordBoundary"


def test_edge_retries_then_succeeds(fake_edge):
    FakeCommunicate.fail_times = 2
    res = asyncio.run(EdgeProvider().synthesize("hello world", "edge:en-US-AvaMultilingualNeural", "en"))
    assert len(res.boundaries) == 2
    assert len(FakeCommunicate.calls) == 3


def test_edge_reports_failure(fake_edge):
    FakeCommunicate.fail_times = 5
    with pytest.raises(TTSError):
        asyncio.run(EdgeProvider().synthesize("hello", "edge:en-US-AvaMultilingualNeural", "en"))


def test_edge_fallback_voice_list_offline(fake_edge, tmp_path):
    async def boom(**kw):
        raise ConnectionError("offline")
    fake_edge.list_voices = boom
    voices = asyncio.run(EdgeProvider(str(tmp_path)).list_voices())
    ids = {v.id for v in voices}
    assert "edge:he-IL-HilaNeural" in ids and "edge:he-IL-AvriNeural" in ids
