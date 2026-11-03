"""Content-addressed disk cache for synthesized audio + timing metadata.

The key covers provider, voice, synthesis rate/pitch, provider version and the
exact spoken text.  Playback speed is applied in the player, so changing speed
never regenerates audio; changing voice or a pronunciation only regenerates the
chunks whose spoken text actually changed.
"""
from __future__ import annotations

import hashlib
import json
import os
import threading
import time
from typing import Optional, Tuple


def cache_key(provider: str, provider_version: str, voice: str, rate: int, pitch: int, text: str) -> str:
    h = hashlib.sha256()
    h.update(json.dumps([provider, provider_version, voice, rate, pitch, text], ensure_ascii=False).encode("utf-8"))
    return h.hexdigest()[:40]


class AudioCache:
    def __init__(self, root: str, max_bytes: int = 3 * 1024 ** 3):
        self.root = root
        self.max_bytes = max_bytes
        os.makedirs(root, exist_ok=True)
        self._puts = 0
        self._lock = threading.Lock()

    def _paths(self, key: str, ext: str) -> Tuple[str, str]:
        d = os.path.join(self.root, key[:2])
        return os.path.join(d, f"{key}.{ext}"), os.path.join(d, f"{key}.json")

    def get(self, key: str) -> Optional[dict]:
        meta_path = os.path.join(self.root, key[:2], f"{key}.json")
        if not os.path.exists(meta_path):
            return None
        try:
            with open(meta_path, encoding="utf-8") as fh:
                meta = json.load(fh)
            audio_path, _ = self._paths(key, meta["ext"])
            if not os.path.exists(audio_path):
                return None
            now = time.time()
            os.utime(meta_path, (now, now))
            meta["path"] = audio_path
            return meta
        except Exception:
            return None

    def put(self, key: str, audio: bytes, ext: str, meta: dict) -> dict:
        audio_path, meta_path = self._paths(key, ext)
        os.makedirs(os.path.dirname(audio_path), exist_ok=True)
        tmp = audio_path + ".tmp"
        with open(tmp, "wb") as fh:
            fh.write(audio)
        os.replace(tmp, audio_path)
        meta = dict(meta, ext=ext, key=key, created=time.time())
        tmpm = meta_path + ".tmp"
        with open(tmpm, "w", encoding="utf-8") as fh:
            json.dump(meta, fh, ensure_ascii=False)
        os.replace(tmpm, meta_path)
        with self._lock:
            self._puts += 1
            if self._puts % 50 == 0:
                self.evict()
        meta["path"] = audio_path
        return meta

    def path_for(self, key: str) -> Optional[str]:
        m = self.get(key)
        return m["path"] if m else None

    def size(self) -> int:
        total = 0
        for dirpath, _, files in os.walk(self.root):
            for f in files:
                try:
                    total += os.path.getsize(os.path.join(dirpath, f))
                except OSError:
                    pass
        return total

    def evict(self) -> int:
        """Remove least-recently-used entries until under the size limit."""
        entries = []
        total = 0
        for dirpath, _, files in os.walk(self.root):
            for f in files:
                if not f.endswith(".json"):
                    continue
                mp = os.path.join(dirpath, f)
                key = f[:-5]
                size = 0
                for g in files:
                    if g.startswith(key):
                        try:
                            size += os.path.getsize(os.path.join(dirpath, g))
                        except OSError:
                            pass
                try:
                    at = os.path.getmtime(mp)
                except OSError:
                    continue
                entries.append((at, dirpath, key, size))
                total += size
        removed = 0
        if total <= self.max_bytes:
            return 0
        for at, dirpath, key, size in sorted(entries):
            for g in os.listdir(dirpath):
                if g.startswith(key):
                    try:
                        os.remove(os.path.join(dirpath, g))
                    except OSError:
                        pass
            total -= size
            removed += 1
            if total <= self.max_bytes * 0.9:
                break
        return removed

    def clear(self) -> None:
        for dirpath, _, files in os.walk(self.root):
            for f in files:
                try:
                    os.remove(os.path.join(dirpath, f))
                except OSError:
                    pass
