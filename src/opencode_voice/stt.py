"""Speech-to-text provider implementations.

Each provider returns transcribed text for 16kHz mono WAV bytes, plus a
cost estimate for the call.
"""

from __future__ import annotations

from dataclasses import dataclass

import httpx

from .config import STTProvider
from .costs import CostEstimate, stt_cost

# Groq Whisper: standard multipart upload endpoint.
_GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions"

# OpenAI-compatible fallback base URL (e.g. local faster-whisper server).
_OPENAI_URL = "https://api.openai.com/v1/audio/transcriptions"


@dataclass
class STTResult:
    text: str
    cost: CostEstimate


def transcribe(provider: STTProvider, wav_bytes: bytes) -> STTResult:
    """Transcribe WAV bytes using the configured provider."""
    dispatch = {
        "groq": _transcribe_openai_compatible,
        "openai": _transcribe_openai_compatible,
        "local": _transcribe_local,
    }
    handler = dispatch.get(provider.name, _transcribe_openai_compatible)
    return handler(provider, wav_bytes)


def _transcribe_openai_compatible(provider: STTProvider, wav_bytes: bytes) -> STTResult:
    url = provider.base_url or (
        _GROQ_URL if provider.name == "groq" else _OPENAI_URL
    )
    api_key = provider.api_key
    if not api_key:
        raise RuntimeError(
            f"STT provider '{provider.name}' requires an API key "
            "(set VOICE_STT_API_KEY or the STT_API_KEY env var)."
        )

    files = {"file": ("input.wav", wav_bytes, "audio/wav")}
    data = {"model": provider.model}
    with httpx.Client(timeout=60) as client:
        resp = client.post(url, headers={"Authorization": f"Bearer {api_key}"}, files=files, data=data)
        resp.raise_for_status()
        text = resp.json()["text"].strip()
    return STTResult(text=text, cost=stt_cost(provider.name, provider.model, _audio_seconds(wav_bytes)))


def _transcribe_local(provider: STTProvider, wav_bytes: bytes) -> STTResult:
    """POST to a local OpenAI-compatible whisper server."""
    url = provider.base_url or "http://127.0.0.1:9000/v1/audio/transcriptions"
    files = {"file": ("input.wav", wav_bytes, "audio/wav")}
    data = {"model": provider.model}
    with httpx.Client(timeout=60) as client:
        resp = client.post(url, files=files, data=data)
        resp.raise_for_status()
        text = resp.json()["text"].strip()
    return STTResult(text=text, cost=stt_cost(provider.name, provider.model, _audio_seconds(wav_bytes)))


def _audio_seconds(wav_bytes: bytes) -> float:
    """Read audio duration from a WAV byte buffer (16kHz mono 16-bit)."""
    import io
    import wave

    with wave.open(io.BytesIO(wav_bytes), "rb") as w:
        frames = w.getnframes()
        rate = w.getframerate()
    if rate <= 0:
        return 0.0
    return frames / rate
