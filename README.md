# opencode-voice

Voice conversation plugin for **OpenCode TUI** with:

- **STT**: Groq Whisper (`whisper-large-v3-turbo`) — record via `sox`, transcribe via Groq API
- **TTS**: xAI Grok TTS (`eve`, Japanese supported) — synthesize via `api.x.ai/v1/tts`, play via `mpv`
- **LLM**: OpenRouter / DeepSeek v4-flash for STT cleanup and TTS narration
- **Cost ledger**: every STT/LLM/TTS call is recorded to `~/.local/share/opencode-voice/ledger.jsonl`
- **Sidebar panel**: live cost totals rendered in the OpenCode TUI right sidebar (`sidebar_content` slot)

Directory-independent: the ledger path is resolved from the user home, not the
working directory (fixes the startup-directory dependency of the earlier
Python/pixi version).

## Install

Add the plugin to `~/.config/opencode/tui.json`:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "keybinds": { "session_rename": "none" },
  "plugin": [
    ["/path/to/opencode-voice", {
      "sttModel": "whisper-large-v3-turbo",
      "ttsVoice": "eve",
      "ttsLanguage": "ja",
      "llmEndpoint": "https://openrouter.ai/api/v1",
      "llmModel": "deepseek/deepseek-v4-flash",
      "llmApiKeyEnv": "OPENROUTER_API_KEY"
    }]
  ]
}
```

Restart OpenCode. The plugin loads at startup.

### Prerequisites

- `sox` (recording) and `mpv` (playback) on PATH
- API keys in the environment (or `.env`):
  - `GROQ_API_KEY` — STT
  - `XAI_API_KEY` — TTS
  - `OPENROUTER_API_KEY` — LLM normalization

## Commands

| Command | Keybind | Description |
|---|---|---|
| `/voice-record` | `ctrl+r` | Start/stop recording + transcribe (append to prompt) |
| `/voice-submit` | `leader+r` | Stop recording, transcribe, and submit prompt |
| `/voice-stop` | — | Cancel recording |
| `/voice-speak` | `leader+s` | Read last assistant response aloud (xAI TTS) |
| `/voice-mode` | `leader+v` | Toggle auto TTS on/off |
| `/voice-stop-tts` | `escape` | Stop playback |

## Cost ledger

Every call appends a JSON line to `~/.local/share/opencode-voice/ledger.jsonl`:

```json
{"ts":"2026-08-23T06:43:23Z","kind":"stt","model":"whisper-large-v3-turbo","audio_seconds":8.1,"cost_usd":0.00011111}
{"ts":"2026-08-23T06:44:01Z","kind":"llm","model":"deepseek/deepseek-v4-flash","provider":"openrouter","cost_usd":0.00000392}
{"ts":"2026-08-23T06:45:10Z","kind":"tts","voice":"eve","language":"ja","chars":14,"cost_usd":0.00021}
```

Override the path with `OPENCODE_VOICE_LEDGER`.

### Pricing sources (2026-08)

| Provider | Basis | Rate |
|---|---|---|
| Groq STT `whisper-large-v3-turbo` | per hour of audio (10s min) | $0.04 / hr |
| OpenRouter `deepseek-v4-flash` | tokens (off-peak) | $0.22 in / $0.66 out / 1M |
| xAI TTS | per character | $15.00 / 1M chars |

OpenRouter returns an exact `usage.cost`; when present it is used verbatim.
Other providers fall back to the table in `lib/costs.js`.

## Sidebar panel

The plugin registers a `sidebar_content` slot that polls the ledger every 2s
and shows:

```
Voice Costs
STT $0.0002 (8s)
LLM $0.0000
TTS $0.0002 (14 chars)
Total $0.0004
events: 4
```

## Development

```bash
bun install
node --test test/   # unit tests
bun -e "import('./index.js').then(m => console.log(m.default.id))"  # load check
```

## Layout

```
index.js          TUI plugin entry (commands, events, slot registration)
lib/costs.js      cost estimation tables
lib/ledger.js     JSONL cost ledger (home-based path)
lib/stt.js        sox recording + Groq transcription
lib/tts.js        xAI TTS synthesis + mpv playback
lib/llm.js        OpenRouter/DeepSeek normalization client
lib/prompts.js    STT cleanup / TTS narration prompts
lib/panel.js      SolidJS sidebar panel (no JSX)
test/             node:test unit tests
```

## License

MIT
