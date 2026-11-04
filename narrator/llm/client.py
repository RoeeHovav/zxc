"""Minimal OpenAI-compatible chat client.

Works with free local servers (Ollama at http://127.0.0.1:11434/v1, LM Studio,
llama.cpp server) and with hosted OpenAI-compatible APIs.  Only used for the
optional Teacher Mode; the narrator never needs an LLM to read a document.
"""
from __future__ import annotations

from typing import List, Optional
from urllib.parse import urlparse

import httpx


class LLMError(Exception):
    pass


def is_local(base_url: str) -> bool:
    host = (urlparse(base_url).hostname or "").lower()
    return host in ("127.0.0.1", "localhost", "::1")


class LLMClient:
    def __init__(self, base_url: str, model: str, api_key: Optional[str] = None, timeout: float = 180.0,
                 transport: Optional[httpx.AsyncBaseTransport] = None):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.api_key = api_key
        self.timeout = timeout
        self.transport = transport

    def _client(self) -> httpx.AsyncClient:
        headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}
        return httpx.AsyncClient(timeout=self.timeout, headers=headers, transport=self.transport, trust_env=not is_local(self.base_url))

    async def models(self) -> List[str]:
        async with self._client() as c:
            r = await c.get(f"{self.base_url}/models")
            if r.status_code != 200:
                raise LLMError(f"HTTP {r.status_code}: {r.text[:200]}")
            return [m.get("id", "") for m in r.json().get("data", [])]

    async def chat(self, messages: List[dict], max_tokens: int = 700, temperature: float = 0.3) -> str:
        if not self.model:
            raise LLMError("No model selected for Teacher Mode (Settings → Teacher Mode).")
        body = {"model": self.model, "messages": messages, "max_tokens": max_tokens, "temperature": temperature, "stream": False}
        try:
            async with self._client() as c:
                r = await c.post(f"{self.base_url}/chat/completions", json=body)
        except httpx.HTTPError as exc:
            raise LLMError(f"Could not reach the language model at {self.base_url}: {exc}") from exc
        if r.status_code != 200:
            raise LLMError(f"Language model error HTTP {r.status_code}: {r.text[:300]}")
        try:
            return r.json()["choices"][0]["message"]["content"].strip()
        except Exception as exc:
            raise LLMError(f"Unexpected response from the language model: {r.text[:300]}") from exc
