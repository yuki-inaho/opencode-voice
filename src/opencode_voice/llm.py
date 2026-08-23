"""Language-model provider implementations (OpenAI-compatible chat APIs)."""

from __future__ import annotations

from dataclasses import dataclass

import httpx

from .config import LLMProvider
from .costs import CostEstimate, llm_cost

# OpenAI-compatible base URLs per provider.
_BASE_URLS = {
    "openrouter": "https://openrouter.ai/api/v1",
    "xai": "https://api.x.ai/v1",
    "groq": "https://api.groq.com/openai/v1",
    "openai": "https://api.openai.com/v1",
    "deepseek": "https://api.deepseek.com/v1",
    "local": "http://127.0.0.1:11434/v1",
}

# Per-provider API key env var hints.
_KEY_ENV = {
    "openrouter": "OPENROUTER_API_KEY",
    "xai": "XAI_API_KEY",
    "groq": "GROQ_API_KEY",
    "openai": "OPENAI_API_KEY",
    "deepseek": "DEEPSEEK_API_KEY",
}


@dataclass
class LLMResult:
    text: str
    cost: CostEstimate
    usage: dict


def chat(provider: LLMProvider, messages: list[dict], max_tokens: int) -> LLMResult:
    """Send a chat completion request and return the assistant reply plus cost."""
    base_url = provider.base_url or _BASE_URLS.get(provider.name, "")
    if not base_url:
        raise RuntimeError(
            f"Unknown LLM provider '{provider.name}'. Set VOICE_LLM_BASE_URL "
            "or use one of: {0}.".format(", ".join(_BASE_URLS))
        )
    api_key = provider.api_key
    if not api_key:
        raise RuntimeError(
            f"LLM provider '{provider.name}' requires an API key "
            f"(set VOICE_LLM_API_KEY or the {_KEY_ENV.get(provider.name, 'LLM_API_KEY')} env var)."
        )

    url = base_url.rstrip("/") + "/chat/completions"
    payload = {
        "model": provider.model,
        "messages": messages,
        "max_tokens": max_tokens,
        "stream": False,
    }
    with httpx.Client(timeout=120) as client:
        resp = client.post(
            url,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
        resp.raise_for_status()
        data = resp.json()
        text = data["choices"][0]["message"]["content"].strip()
        usage = data.get("usage", {}) or {}
        return LLMResult(
            text=text,
            usage=usage,
            cost=llm_cost(provider.name, usage, provider.model),
        )
