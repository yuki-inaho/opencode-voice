"""Unit tests for cost estimation."""

import pytest

from opencode_voice import costs


def test_stt_cost_minimum_billable_seconds() -> None:
    cost = costs.stt_cost("groq", "whisper-large-v3-turbo", 5.0)
    assert cost.usd == pytest.approx(0.04 * (10.0 / 3600.0))


def test_stt_cost_scales_with_audio_length() -> None:
    cost = costs.stt_cost("groq", "whisper-large-v3-turbo", 30.0)
    assert cost.usd == pytest.approx(0.04 * (30.0 / 3600.0))


def test_stt_cost_large_v3_rate() -> None:
    cost = costs.stt_cost("groq", "whisper-large-v3", 10.0)
    assert cost.usd == pytest.approx(0.111 * (10.0 / 3600.0))


def test_stt_cost_unknown_model_falls_back() -> None:
    cost = costs.stt_cost("groq", "unknown-model", 10.0)
    assert cost.usd > 0.0


def test_tts_cost_xai_per_char() -> None:
    text = "こんにちは" * 20  # 100 chars
    cost = costs.tts_cost("xai", text)
    assert cost.usd == pytest.approx(100 / 1_000_000 * 15.0)


def test_tts_cost_non_xai_is_free() -> None:
    assert costs.tts_cost("edge", "any text").usd == 0.0


def test_llm_cost_openrouter_uses_usage_cost() -> None:
    cost = costs.llm_cost("openrouter", {"cost": 0.001234})
    assert cost.usd == pytest.approx(0.001234)


def test_llm_cost_deepseek_token_based() -> None:
    usage = {"prompt_tokens": 1000, "completion_tokens": 500}
    cost = costs.llm_cost("deepseek", usage)
    assert cost.usd == pytest.approx(1000 / 1e6 * 0.22 + 500 / 1e6 * 0.66)


def test_llm_cost_unknown_provider_free() -> None:
    assert costs.llm_cost("local", {}).usd == 0.0


def test_session_costs_accumulate() -> None:
    from opencode_voice.chat import SessionCosts

    sc = SessionCosts()
    sc.add_stt(costs.stt_cost("groq", "whisper-large-v3-turbo", 10.0))
    sc.add_llm(
        costs.llm_cost("deepseek", {"prompt_tokens": 1000, "completion_tokens": 500})
    )
    sc.add_tts(costs.tts_cost("xai", "こんにちは"))

    assert sc.stt == pytest.approx(0.04 * (10.0 / 3600.0))
    assert sc.llm == pytest.approx(1000 / 1e6 * 0.22 + 500 / 1e6 * 0.66)
    assert sc.tts == pytest.approx(5 / 1e6 * 15.0)
    assert sc.total == pytest.approx(sc.stt + sc.llm + sc.tts)
