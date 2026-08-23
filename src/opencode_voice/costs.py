"""Cost estimation for voice conversation providers (all values in USD).

Pricing tables are kept in one place so a turn can report exactly what
each STT/LLM/TTS call cost. Rates reflect published provider pricing:
- xAI TTS: per 1M characters
- Groq STT: per hour of audio, with a 10-second minimum billable amount
- LLM providers: per 1M tokens (input and output)
"""

from __future__ import annotations

from dataclasses import dataclass

# --- xAI TTS -----------------------------------------------------------

XAI_TTS_USD_PER_1M_CHARS = 15.0

# --- Groq STT ----------------------------------------------------------

GROQ_STT_USD_PER_HOUR = {
    "whisper-large-v3": 0.111,
    "whisper-large-v3-turbo": 0.04,
}
GROQ_STT_MIN_BILLABLE_SECONDS = 10.0

# --- LLM per 1M tokens (peak, USD) -------------------------------------

LLM_USD_PER_1M_TOKENS = {
    "openrouter": {"input": 0.22, "output": 0.66},  # deepseek-v4-flash (off-peak)
    "deepseek": {"input": 0.22, "output": 0.66},  # deepseek-v4-flash (off-peak)
    "xai": {"input": 2.0, "output": 6.0},  # grok-4.6
    "openai": {"input": 2.5, "output": 10.0},  # gpt-4o
    "groq": {"input": 0.59, "output": 0.79},  # llama-3.3-70b-versatile
}

# OpenRouter usage reports a concrete `cost` field we trust verbatim.
OPENROUTER_USES_USAGE_COST = True


@dataclass(frozen=True)
class CostEstimate:
    usd: float

    def __str__(self) -> str:
        if self.usd == 0.0:
            return "$0.00"
        if self.usd >= 0.01:
            return f"${self.usd:.2f}"
        if self.usd >= 0.0001:
            return f"${self.usd:.4f}"
        return f"${self.usd:.6f}"


def stt_cost(provider_name: str, model: str, audio_seconds: float) -> CostEstimate:
    """Estimate Groq STT cost from recorded audio length.

    Groq bills per hour of audio with a minimum of 10 seconds per request.
    """
    table = GROQ_STT_USD_PER_HOUR
    rate = table.get(model, table.get(provider_name)) if provider_name == "groq" else None
    if rate is None:
        rate = next(iter(table.values())) if table else 0.0
    billable = max(audio_seconds, GROQ_STT_MIN_BILLABLE_SECONDS)
    return _estimate(billable / 3600.0 * rate)


def tts_cost(provider_name: str, text: str) -> CostEstimate:
    """Estimate xAI TTS cost from the number of characters synthesized."""
    if provider_name == "xai":
        return _estimate(len(text) / 1_000_000.0 * XAI_TTS_USD_PER_1M_CHARS)
    return _estimate(0.0)


def llm_cost(
    provider_name: str,
    usage: dict,
    model: str | None = None,
) -> CostEstimate:
    """Estimate LLM cost from usage token counts.

    OpenRouter returns an exact `usage.cost` field (USD); when present we
    use it directly. Other providers fall back to a per-1M-token table.
    """
    if OPENROUTER_USES_USAGE_COST and provider_name == "openrouter":
        cost = usage.get("cost")
        if cost is not None:
            return _estimate(float(cost))

    prompt_tokens = int(usage.get("prompt_tokens", 0))
    completion_tokens = int(usage.get("completion_tokens", 0))
    rates = LLM_USD_PER_1M_TOKENS.get(provider_name)
    if rates is None:
        return _estimate(0.0)
    input_cost = prompt_tokens / 1_000_000.0 * rates.get("input", 0.0)
    output_cost = completion_tokens / 1_000_000.0 * rates.get("output", 0.0)
    return _estimate(input_cost + output_cost)


def _estimate(value: float) -> CostEstimate:
    return CostEstimate(round(value, 10))