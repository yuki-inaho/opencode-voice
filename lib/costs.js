// Cost estimation for voice conversation providers (all values in USD).
//
// Rates reflect published provider pricing as of 2026-08:
// - xAI TTS: $15.00 / 1M characters
// - Groq STT: per hour of audio with a 10-second minimum billable amount
// - LLM: per 1M tokens (DeepSeek v4-flash off-peak via OpenRouter)

export const XAI_TTS_USD_PER_1M_CHARS = 15.0;

export const GROQ_STT_USD_PER_HOUR = {
  "whisper-large-v3": 0.111,
  "whisper-large-v3-turbo": 0.04,
};
export const GROQ_STT_MIN_BILLABLE_SECONDS = 10.0;

export const LLM_USD_PER_1M_TOKENS = {
  openrouter: { input: 0.22, output: 0.66 }, // deepseek-v4-flash (off-peak)
  deepseek: { input: 0.22, output: 0.66 }, // deepseek-v4-flash (off-peak)
  xai: { input: 2.0, output: 6.0 }, // grok-4.6
  openai: { input: 2.5, output: 10.0 }, // gpt-4o
  groq: { input: 0.59, output: 0.79 }, // llama-3.3-70b-versatile
};

// OpenRouter returns an exact `usage.cost` field which we trust verbatim.
const OPENROUTER_USES_USAGE_COST = true;

function round(value, digits = 8) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Format a USD amount with adaptive precision. */
export function formatUsd(value) {
  if (value === 0) return "$0.00";
  if (value >= 0.01) return `$${value.toFixed(2)}`;
  if (value >= 0.0001) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(6)}`;
}

/** Estimate Groq STT cost from recorded audio length (seconds). */
export function sttCost(model, audioSeconds) {
  const rate = GROQ_STT_USD_PER_HOUR[model];
  const billable = Math.max(audioSeconds, GROQ_STT_MIN_BILLABLE_SECONDS);
  const hours = billable / 3600.0;
  return round(hours * (rate ?? Object.values(GROQ_STT_USD_PER_HOUR)[0]));
}

/** Estimate xAI TTS cost from the number of characters synthesized. */
export function ttsCost(text) {
  return round((text.length / 1_000_000) * XAI_TTS_USD_PER_1M_CHARS);
}

/** Estimate LLM cost from usage token counts (or exact OpenRouter cost). */
export function llmCost(providerName, usage = {}) {
  if (OPENROUTER_USES_USAGE_COST && providerName === "openrouter") {
    if (usage.cost != null) return round(Number(usage.cost));
  }
  const promptTokens = Number(usage.prompt_tokens ?? 0);
  const completionTokens = Number(usage.completion_tokens ?? 0);
  const rates = LLM_USD_PER_1M_TOKENS[providerName];
  if (!rates) return 0;
  const inputCost = (promptTokens / 1_000_000) * (rates.input ?? 0);
  const outputCost = (completionTokens / 1_000_000) * (rates.output ?? 0);
  return round(inputCost + outputCost);
}
