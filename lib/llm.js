// LLM client for text normalization (STT cleanup / TTS narration).
//
// Uses an OpenAI-compatible chat completions endpoint. The default points at
// OpenRouter serving DeepSeek v4-flash (cheap, off-peak). Configured via
// plugin options:
//   { "llmEndpoint": "...", "llmModel": "...", "llmApiKeyEnv": "..." }

import { llmCost } from "./costs.js";
import { appendLedger } from "./ledger.js";

const DEFAULT_ENDPOINT = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = "deepseek/deepseek-v4-flash";
const DEFAULT_API_KEY_ENV = "OPENROUTER_API_KEY";

/** Create a completion function that also records LLM cost. */
export function createLlmClient(options = {}, logger) {
  const endpoint = (options.llmEndpoint || DEFAULT_ENDPOINT).replace(/\/+$/, "");
  const model = options.llmModel || DEFAULT_MODEL;
  const apiKeyEnv = options.llmApiKeyEnv || DEFAULT_API_KEY_ENV;
  const provider = options.llmProvider || (endpoint.includes("openrouter") ? "openrouter" : "openai");

  async function complete({ system, prompt, maxTokens = 2048 }) {
    const apiKey = process.env[apiKeyEnv];
    if (!apiKey) {
      logger?.log?.("LLM", `${apiKeyEnv} not set, skipping normalization`, "warn");
      return { text: null, error: `${apiKeyEnv} not set` };
    }

    const messages = [];
    if (system) messages.push({ role: "system", content: system });
    messages.push({ role: "user", content: prompt });

    const payload = {
      model,
      messages,
      max_tokens: maxTokens,
      stream: false,
    };

    try {
      const resp = await fetch(endpoint + "/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const body = await resp.text();
        logger?.log?.("LLM", `HTTP ${resp.status}: ${body}`, "error");
        return { text: null, error: `LLM HTTP ${resp.status}` };
      }
      const data = await resp.json();
      const text = data.choices?.[0]?.message?.content?.trim() ?? null;
      const usage = data.usage ?? {};
      const cost = llmCost(provider, usage);
      appendLedger({ kind: "llm", model, provider, usage, cost_usd: cost });
      return { text, usage, cost };
    } catch (err) {
      logger?.log?.("LLM", `request failed: ${err.message}`, "error");
      return { text: null, error: err.message };
    }
  }

  return complete;
}
