import { test } from "node:test";
import assert from "node:assert/strict";

import {
  sttCost,
  ttsCost,
  llmCost,
  formatUsd,
  XAI_TTS_USD_PER_1M_CHARS,
} from "../lib/costs.js";

function approx(actual, expected, eps = 1e-7) {
  assert.ok(Math.abs(actual - expected) < eps, `expected ${actual} ~= ${expected}`);
}

test("sttCost applies 10s minimum billable", () => {
  approx(sttCost("whisper-large-v3-turbo", 5), (0.04 * 10) / 3600);
});

test("sttCost scales with audio length", () => {
  approx(sttCost("whisper-large-v3-turbo", 30), (0.04 * 30) / 3600);
});

test("sttCost uses large-v3 rate", () => {
  approx(sttCost("whisper-large-v3", 10), (0.111 * 10) / 3600);
});

test("sttCost falls back for unknown model", () => {
  assert.ok(sttCost("unknown-model", 10) > 0);
});

test("ttsCost is per 1M chars", () => {
  const text = "こんにちは".repeat(20); // 100 chars
  approx(ttsCost(text), (100 / 1_000_000) * XAI_TTS_USD_PER_1M_CHARS);
});

test("llmCost uses exact OpenRouter usage.cost", () => {
  assert.equal(llmCost("openrouter", { cost: 0.001234 }), 0.001234);
});

test("llmCost falls back to token table", () => {
  const usage = { prompt_tokens: 1000, completion_tokens: 500 };
  approx(llmCost("deepseek", usage), (1000 / 1e6) * 0.22 + (500 / 1e6) * 0.66);
});

test("llmCost unknown provider is free", () => {
  assert.equal(llmCost("local", {}), 0);
});

test("formatUsd adaptive precision", () => {
  assert.equal(formatUsd(0), "$0.00");
  assert.equal(formatUsd(1.5), "$1.50");
  assert.equal(formatUsd(0.0015), "$0.0015");
  assert.equal(formatUsd(0.0001), "$0.0001");
});
