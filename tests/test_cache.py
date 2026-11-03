from narrator.narration.cache import AudioCache, cache_key


def test_key_depends_on_voice_and_text_not_speed():
    a = cache_key("edge", "1", "edge:he-IL-HilaNeural", 0, 0, "שלום")
    assert a == cache_key("edge", "1", "edge:he-IL-HilaNeural", 0, 0, "שלום")
    assert a != cache_key("edge", "1", "edge:he-IL-AvriNeural", 0, 0, "שלום")
    assert a != cache_key("edge", "1", "edge:he-IL-HilaNeural", 0, 0, "שָׁלוֹם")


def test_put_get_and_eviction(tmp_path):
    c = AudioCache(str(tmp_path), max_bytes=10_000)
    for i in range(10):
        c.put(f"{i:040d}", b"x" * 2000, "mp3", {"duration": 1.0, "boundaries": []})
    assert c.get(f"{9:040d}")["duration"] == 1.0
    removed = c.evict()
    assert removed > 0 and c.size() <= 10_000
