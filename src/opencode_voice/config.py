"""Configuration for the voice conversation CLI.

Providers are selected via environment variables (or a config YAML). All
keys are optional; defaults are provider-agnostic where possible.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

import yaml

_ENV_PREFIX = "VOICE_"
_CONFIG_NAME = "config.yaml"


@dataclass(frozen=True)
class Provider:
    name: str


@dataclass(frozen=True)
class TTSProvider(Provider):
    voice: str = ""
    language: str = ""
    model: str = ""
    base_url: str = ""
    api_key: str = ""
    endpoint: str = ""


@dataclass(frozen=True)
class STTProvider(Provider):
    model: str = ""
    base_url: str = ""
    api_key: str = ""


@dataclass(frozen=True)
class LLMProvider(Provider):
    model: str = ""
    base_url: str = ""
    api_key: str = ""


@dataclass(frozen=True)
class Conversation:
    system_prompt: str = (
        "You are a friendly voice conversation assistant. Keep replies short "
        "and natural, suitable for spoken dialogue. Do not use markdown."
    )
    history_limit: int = 20
    max_tokens: int = 512


@dataclass(frozen=True)
class AudioConfig:
    sample_rate: int = 16000
    channels: int = 1
    input_device: int | None = None
    output_device: int | None = None
    silence_timeout_s: float = 1.2
    max_record_s: float = 30.0
    vad_threshold: float = 0.02


@dataclass(frozen=True)
class Config:
    stt: STTProvider
    llm: LLMProvider
    tts: TTSProvider
    conversation: Conversation = field(default_factory=Conversation)
    audio: AudioConfig = field(default_factory=AudioConfig)


def _env(name: str, default: str = "") -> str:
    return os.environ.get(_ENV_PREFIX + name, default) or default


def _first_env(*names: str) -> str:
    for n in names:
        v = os.environ.get(n)
        if v:
            return v
    return ""


# Provider -> well-known API key env var names (used as fallbacks).
_STT_KEY_ENV = {
    "groq": "GROQ_API_KEY",
    "openai": "OPENAI_API_KEY",
}
_LLM_KEY_ENV = {
    "openrouter": "OPENROUTER_API_KEY",
    "xai": "XAI_API_KEY",
    "groq": "GROQ_API_KEY",
    "openai": "OPENAI_API_KEY",
    "deepseek": "DEEPSEEK_API_KEY",
}
_TTS_KEY_ENV = {
    "xai": "XAI_API_KEY",
    "openai": "OPENAI_API_KEY",
    "elevenlabs": "ELEVENLABS_API_KEY",
}


def _resolve_api_key(provider_name: str, section: dict, fallbacks: dict) -> str:
    """Resolve an API key: explicit env override, then config value, then a
    well-known provider-specific env var."""
    explicit = _first_env("VOICE_API_KEY", "API_KEY")
    if explicit:
        return explicit
    if section.get("api_key"):
        return section["api_key"]
    return _first_env(fallbacks.get(provider_name, ""))


def _load_yaml(path: Path | None) -> dict:
    if path is None or not path.is_file():
        return {}
    with path.open(encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    return data if isinstance(data, dict) else {}


def load_config(config_path: Path | None = None) -> Config:
    """Load configuration from the given YAML path (or cwd/config.yaml)."""
    path = config_path or Path.cwd() / _CONFIG_NAME
    raw = _load_yaml(path)

    stt_raw = raw.get("stt", {})
    llm_raw = raw.get("llm", {})
    tts_raw = raw.get("tts", {})
    audio_raw = raw.get("audio", {})

    stt_name = _env("STT", stt_raw.get("provider", "groq"))
    llm_name = _env("LLM", llm_raw.get("provider", "openrouter"))
    tts_name = _env("TTS", tts_raw.get("provider", "xai"))

    stt = STTProvider(
        name=stt_name,
        model=_env("STT_MODEL", stt_raw.get("model", "whisper-large-v3")),
        base_url=_env("STT_BASE_URL", stt_raw.get("base_url", "")),
        api_key=_resolve_api_key(stt_name, stt_raw, _STT_KEY_ENV),
    )
    llm = LLMProvider(
        name=llm_name,
        model=_env("LLM_MODEL", llm_raw.get("model", "deepseek/deepseek-v4-flash")),
        base_url=_env("LLM_BASE_URL", llm_raw.get("base_url", "")),
        api_key=_resolve_api_key(llm_name, llm_raw, _LLM_KEY_ENV),
    )
    tts = TTSProvider(
        name=tts_name,
        voice=_env("TTS_VOICE", tts_raw.get("voice", "eve")),
        language=_env("TTS_LANGUAGE", tts_raw.get("language", "ja")),
        model=_env("TTS_MODEL", tts_raw.get("model", "")),
        base_url=_env("TTS_BASE_URL", tts_raw.get("base_url", "")),
        api_key=_resolve_api_key(tts_name, tts_raw, _TTS_KEY_ENV),
        endpoint=_env("TTS_ENDPOINT", tts_raw.get("endpoint", "/tts")),
    )
    conversation = Conversation(
        system_prompt=_env(
            "SYSTEM_PROMPT",
            raw.get("system_prompt", Conversation().system_prompt),
        ),
        history_limit=int(
            _env("HISTORY_LIMIT", str(raw.get("history_limit", 20)))
        ),
        max_tokens=int(_env("MAX_TOKENS", str(raw.get("max_tokens", 512)))),
    )

    audio = AudioConfig(
        sample_rate=int(_env("SAMPLE_RATE", str(audio_raw.get("sample_rate", 16000)))),
        channels=int(_env("CHANNELS", str(audio_raw.get("channels", 1)))),
        input_device=_opt_int(_env("INPUT_DEVICE", str(audio_raw.get("input_device", "none")))),
        output_device=_opt_int(_env("OUTPUT_DEVICE", str(audio_raw.get("output_device", "none")))),
        silence_timeout_s=float(
            _env("SILENCE_TIMEOUT", str(audio_raw.get("silence_timeout_s", 1.2)))
        ),
        max_record_s=float(
            _env("MAX_RECORD", str(audio_raw.get("max_record_s", 30.0)))
        ),
        vad_threshold=float(
            _env("VAD_THRESHOLD", str(audio_raw.get("vad_threshold", 0.02)))
        ),
    )

    return Config(stt=stt, llm=llm, tts=tts, conversation=conversation, audio=audio)


def _opt_int(value: str) -> int | None:
    return None if value in ("", "none", "None") else int(value)


def summary(cfg: Config) -> str:
    return (
        f"STT: {cfg.stt.name} ({cfg.stt.model})\n"
        f"LLM: {cfg.llm.name} ({cfg.llm.model})\n"
        f"TTS: {cfg.tts.name} (voice={cfg.tts.voice}, lang={cfg.tts.language})"
    )
