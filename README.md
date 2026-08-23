# opencode-voice

Flexible voice conversation CLI for OpenCode.

Pipeline: **record → STT → LLM → TTS → playback**, with conversation history and per-call / session cost reporting.

## Features

- STT via Groq Whisper (`whisper-large-v3-turbo`)
- LLM conversation via OpenRouter (cheap `deepseek-v4-flash`) or other OpenAI-compatible providers
- TTS via xAI Grok TTS (Japanese supported)
- Per-call cost display: `[STT]`, `[LLM]`, `[TTS]` with running session totals
- Providers are configurable via `config.yaml` or environment variables

## Setup

```bash
# API keys (either via env or .env)
export GROQ_API_KEY="gsk_..."
export OPENROUTER_API_KEY="sk-or-..."
export XAI_API_KEY="xai-..."

# Install (uv)
uv pip install -e ".[dev]"

# Or pixi
pixi install
```

## Run

```bash
opencode-voice                 # start voice conversation
opencode-voice --show-config   # show resolved provider config
```

Say something, or `quit` / `bye` to exit.

## Cost reporting

Each turn prints:

```
You: <transcribed text>
  [STT] $0.0001  (session STT total: $0.0001)
AI: <assistant reply>
  [LLM] $0.0006  (session LLM total: $0.0006)
  [TTS] $0.0015  (session TTS total: $0.0015)
  [Session total] $0.0022
```

At exit, a summary of the whole session is printed.

### Pricing sources

| Provider | Basis | Rate |
|---|---|---|
| Groq STT `whisper-large-v3-turbo` | per hour of audio (10s min) | $0.04 / hr |
| OpenRouter `deepseek-v4-flash` | tokens (off-peak) | $0.22 in / $0.66 out / 1M |
| xAI TTS | per character | $15.00 / 1M chars |

OpenRouter returns an exact `usage.cost`; when present it is used verbatim.
Other providers fall back to the table in `src/opencode_voice/costs.py`.

## Configuration

Copy `config.example.yaml` to `config.yaml` and edit. Environment variables
override config values. See `config.py` for the full list.

## Development

```bash
pixi run test    # pytest
pixi run lint    # ruff check
pixi run check   # both
```
