"""Text-to-speech provider implementations.

Each provider returns raw audio bytes plus a suggested file extension so the
player can decode correctly, and a cost estimate for the call.
"""

from __future__ import annotations

import subprocess
from dataclasses import dataclass

import httpx

from .config import TTSProvider
from .costs import CostEstimate, tts_cost

_BASE_URLS = {
    "xai": "https://api.x.ai/v1",
    "openai": "https://api.openai.com/v1",
}

_KEY_ENV = {
    "xai": "XAI_API_KEY",
    "openai": "OPENAI_API_KEY",
    "elevenlabs": "ELEVENLABS_API_KEY",
}


@dataclass
class TTSResult:
    data: bytes
    extension: str  # e.g. "mp3", "wav"
    cost: CostEstimate


def synthesize(provider: TTSProvider, text: str) -> TTSResult:
    """Synthesize speech for the given text using the configured provider."""
    dispatch = {
        "xai": _synthesize_xai,
        "openai": _synthesize_openai,
        "elevenlabs": _synthesize_elevenlabs,
        "edge": _synthesize_edge,
        "kokoro": _synthesize_kokoro,
        "local": _synthesize_local,
    }
    handler = dispatch.get(provider.name)
    if handler is None:
        raise RuntimeError(
            f"Unknown TTS provider '{provider.name}'. Supported: "
            "xai, openai, elevenlabs, edge, kokoro, local."
        )
    return handler(provider, text)


def _require_key(provider: TTSProvider, name: str) -> str:
    key = provider.api_key
    if not key:
        raise RuntimeError(
            f"TTS provider '{provider.name}' requires an API key "
            f"(set VOICE_TTS_API_KEY or the {_KEY_ENV.get(name, 'TTS_API_KEY')} env var)."
        )
    return key


def _synthesize_xai(provider: TTSProvider, text: str) -> TTSResult:
    api_key = _require_key(provider, "xai")
    base_url = provider.base_url or _BASE_URLS["xai"]
    # base_url already includes /v1; endpoint defaults to /tts.
    url = base_url.rstrip("/") + (provider.endpoint or "/tts")
    payload = {
        "text": text,
        "voice": provider.voice or "eve",
        "language": provider.language or "ja",
    }
    if provider.model:
        payload["model"] = provider.model
    with httpx.Client(timeout=120) as client:
        resp = client.post(
            url, headers={"Authorization": f"Bearer {api_key}"}, json=payload
        )
        resp.raise_for_status()
        return TTSResult(data=resp.content, extension="mp3", cost=tts_cost("xai", text))


def _synthesize_openai(provider: TTSProvider, text: str) -> TTSResult:
    api_key = _require_key(provider, "openai")
    base_url = provider.base_url or _BASE_URLS["openai"]
    url = base_url.rstrip("/") + "/audio/speech"
    payload = {
        "model": provider.model or "gpt-4o-mini-tts",
        "voice": provider.voice or "nova",
        "input": text,
    }
    with httpx.Client(timeout=120) as client:
        resp = client.post(
            url, headers={"Authorization": f"Bearer {api_key}"}, json=payload
        )
        resp.raise_for_status()
        return TTSResult(data=resp.content, extension="mp3", cost=tts_cost(provider.name, text))


def _synthesize_elevenlabs(provider: TTSProvider, text: str) -> TTSResult:
    api_key = _require_key(provider, "elevenlabs")
    base_url = provider.base_url or "https://api.elevenlabs.io"
    voice_id = provider.voice or "21m00Tcm4TlvDq8ikWAM"
    url = f"{base_url.rstrip('/')}/v1/text-to-speech/{voice_id}"
    with httpx.Client(timeout=120) as client:
        resp = client.post(
            url,
            headers={"xi-api-key": api_key, "Content-Type": "application/json"},
            json={"text": text, "model_id": provider.model or "eleven_multilingual_v2"},
        )
        resp.raise_for_status()
        return TTSResult(
            data=resp.content,
            extension="mp3",
            cost=tts_cost(provider.name, text),
        )

def _synthesize_edge(provider: TTSProvider, text: str) -> TTSResult:
    """Free local TTS via Microsoft Edge. Requires the `edge-tts` CLI."""
    voice = provider.voice or "ja-JP-NanamiNeural"
    try:
        proc = subprocess.run(
            ["edge-tts", "--voice", voice, "--text", text, "--write-media", "-"],
            capture_output=True,
            check=True,
        )
    except FileNotFoundError as e:
        raise RuntimeError(
            "edge TTS requires the `edge-tts` CLI (pip install edge-tts)."
        ) from e
    return TTSResult(data=proc.stdout, extension="mp3", cost=tts_cost(provider.name, text))


def _synthesize_kokoro(provider: TTSProvider, text: str) -> TTSResult:
    """Local Kokoro TTS via a running kokoro server on 127.0.0.1:7892."""
    base_url = provider.base_url or "http://127.0.0.1:7892"
    with httpx.Client(timeout=120) as client:
        resp = client.post(
            base_url.rstrip("/") + "/tts",
            json={
                "text": text,
                "voice": provider.voice or "af_heart",
                "speed": 1.0,
            },
        )
        resp.raise_for_status()
        file_path = resp.json()["file"]
        data = httpx.get(file_path, timeout=60).content
        return TTSResult(data=data, extension="wav", cost=tts_cost(provider.name, text))


def _synthesize_local(provider: TTSProvider, text: str) -> TTSResult:
    """POST to a configurable local TTS endpoint returning raw audio."""
    base_url = provider.base_url or "http://127.0.0.1:7892"
    with httpx.Client(timeout=120) as client:
        resp = client.post(
            base_url.rstrip("/") + (provider.endpoint or "/tts"),
            json={"text": text, "voice": provider.voice or "default"},
        )
        resp.raise_for_status()
        data = resp.content
        if isinstance(data, bytes):
            return TTSResult(data=data, extension="wav", cost=tts_cost(provider.name, text))
        file_path = resp.json().get("file")
        if file_path:
            return TTSResult(
                data=httpx.get(file_path, timeout=60).content,
                extension="wav",
                cost=tts_cost(provider.name, text),
            )
        raise RuntimeError("local TTS returned an unexpected response")
