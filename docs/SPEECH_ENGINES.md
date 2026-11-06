# Speech engine assessment

Goal: the most natural, human-sounding narration of Hebrew and English study
material, with correct contextual pronunciation. A secondary goal, at the user's
request, is that it should be free.

## Hard constraint encountered

The development environment's network policy blocked:
- `speech.platform.bing.com` (Edge voices);
- `*.tts.speech.microsoft.com` (Azure);
- `api.elevenlabs.io`, `api.openai.com`;
- `huggingface.co` (open models).

**No engine could be listened to during development.** The integration code is
unit-tested against the libraries' documented message formats. Real listening
tests must run on the user's machine with `scripts/make_listening_samples.py`.

## Candidates

| Engine | Hebrew | English | Word timing | Control | Cost (≈55 k chars ≈ 1 h) | Status in app |
|---|---|---|---|---|---|---|
| **Microsoft neural via Edge Read-Aloud** (`edge-tts`) | Hila, Avri (he-IL neural; native Israeli) | Ava/Andrew/Emma/Brian Multilingual, Aria, Jenny, Guy, en-GB/AU/IN/IE… | Yes (WordBoundary) | rate/pitch/volume only, no SSML | **Free** (unofficial endpoint) | **Default**; code tested, live audio unverified |
| **Google Gemini TTS** (`gemini`, API key from AI Studio) | he-IL listed; LLM-based, reads whole-sentence context, so should disambiguate unvowelled words better than word-by-word front-ends | multilingual, steerable by a style instruction | No (sentence-level only) | natural-language style instruction (the app sends a fixed narrator direction) | Free tier with a **small** speech allowance (user hit it after a short paragraph), may be used by Google for product improvement; paid billing optional | Implemented with quota handling and free-voice fall-back; **simulated service only**. Quality reported "great" by the user; volume is the limit |
| Azure AI Speech (same voices) | same | same | Yes | Full SSML: breaks, prosody, phonemes for supported locales, custom lexicon | Free tier 0.5 M chars/month; paid ≈ $15–16 per 1 M chars (third-party figures, verify) ≈ $0.9/h | Implemented, unverified |
| Google Cloud TTS Chirp 3 HD | **he-IL listed** | many | Only with SSML marks | limited | 1 M chars/month free, then $30 per 1 M ≈ $1.65/h | Not implemented — **next candidate to evaluate** |
| ElevenLabs (v3 / v4) | v3 supports Hebrew with explicit language code; stock Hebrew voices rated "good" by a 2025 comparison | excellent, very expressive | character timestamps | style via text | paid plans, roughly $5–15/h | Not implemented (paid; user asked for free) |
| OpenAI gpt-4o-mini-tts | usable, accent tends to be non-native | very natural, steerable via instructions | no | natural-language style instructions | ≈ $0.9/h | Not implemented (paid, no timings) |
| Open source: Phonikud + Piper (Hebrew) | good *pronunciation* (explicit niqqud + stress), less natural voice | — | phoneme durations | full | free, offline | Not implemented — models on Hugging Face (blocked) |
| Open source: Kokoro (English) | no | very natural for its size | via durations | — | free, offline | Not implemented |
| Chatterbox Multilingual | yes (23 languages) | yes | no | — | free, needs a GPU | Not implemented |

Choices made:
1. **Default to the free Microsoft neural voices.**
   - They are the strongest free option for native-sounding modern Israeli Hebrew
     and for English.
   - They report exact word timings, which drive word-level highlighting.
   - Their Hebrew front-end performs its own contextual vowel and stress
     prediction over the whole sentence. The app therefore sends **whole
     paragraphs (≤ 900 characters per request, split only at sentence ends)**,
     never isolated words.
2. **Pronunciation guidance goes through the text**, because this endpoint
   accepts no SSML. That means niqqud on specific words (acronym lexicon, user
   corrections) and expansions. Whether these voices fully honour niqqud is the
   first listening test (`he-niqqud`). If they don't, fixes should be written as
   phonetic respellings, which the correction dialog supports.
3. **Multi-provider architecture.** Each language maps to its own voice,
   `provider:voice` (Settings → voice per language). Adding Google, ElevenLabs
   or an offline engine means one class implementing `TTSProvider.synthesize()`,
   which returns audio and optional word boundaries.

## Recommended evaluation on the user's machine

1. Run `scripts/make_listening_samples.py --pdf <your book>`. Rate Hila vs Avri
   and the English voices in `index.html` or in the in-app Voice lab.
2. Listen to `he-niqqud`: unvowelled vs vowelled. If they differ correctly, the
   niqqud-based lexicon and corrections are effective.
3. Listen to `he-acronyms`: raw vs lexicon. Disable or adjust any built-in entry
   that sounds worse (Pronunciation tab).
4. If Hebrew quality is not yet "human teacher" level, the next step is an
   **evaluation of Google Chirp 3 HD he-IL**, which has a free monthly tier. An
   independent multi-provider Hebrew comparison with samples exists at
   https://github.com/danielrosehill/Hebrew-TTS-Providers.

## Sources (checked November 2026)

- [Azure Speech pricing (free tier 0.5 M neural chars/month)](https://azure.microsoft.com/pricing/details/cognitive-services/speech-services)
- [CostBench: Microsoft Speech pricing](https://costbench.com/software/ai-voice-tools/microsoft-speech/)
- [Google Chirp 3 HD voices (he-IL listed)](https://docs.cloud.google.com/text-to-speech/docs/chirp3-hd)
- [Google Text-to-Speech pricing](https://cloud.google.com/text-to-speech/pricing?hl=nl)
- [ElevenLabs supported languages](https://elevenlabs.io/docs/help-center/other/what-languages-do-you-support)
- [Hebrew TTS provider comparison](https://github.com/danielrosehill/Hebrew-TTS-Providers)
