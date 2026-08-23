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

## Branches

| Branch | Contents |
|---|---|
| `main` | **JS TUI plugin (this)** — OpenCode TUI integration with sidebar panel |
| `python-cli` | Python CLI version (standalone `opencode-voice` command, cost reporting) |
| `upstream-main` | Original JS fork from `renjfk/opencode-voice` (Piper-based) |

## Install

### Plugin directory (recommended)

Place the bundled plugin in the global plugin directory so it is auto-loaded
at startup and is not affected by project `tui.json` overrides:

```bash
bun run install:plugin   # builds dist/opencode-voice.js and copies to ~/.config/opencode/plugins/
```

The plugin loads automatically. **Restart OpenCode** for changes to take
effect (config is read at startup).

### tui.json (alternative)

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

> Note: if a project `.opencode/tui.json` also defines a `plugin` array, it may
> override the global one. The plugin-directory method avoids this entirely.

### Prerequisites

- `sox` (recording) and `mpv` (playback) on PATH
- API keys in the environment (or `.env`):
  - `GROQ_API_KEY` — STT
  - `XAI_API_KEY` — TTS
  - `OPENROUTER_API_KEY` — LLM normalization

## Voice chat mode (push-to-talk)

Three keybindings drive a hands-free conversation loop:

| Key | Command | Action |
|---|---|---|
| `Ctrl+Alt+C` | `voice.reply-mode.toggle` | Toggle **voice reply mode** (auto-TTS every assistant turn) |
| `Ctrl+Alt+/` | `voice.chat.start` | Start recording (push-to-talk) |
| `Ctrl+Alt+\` | `voice.chat.send` | Stop recording, transcribe (Groq), submit prompt, speak the reply (xAI TTS) |

Workflow: press `Ctrl+Alt+/` and speak → press `Ctrl+Alt+\` → the plugin
transcribes with Groq Whisper, normalizes with the LLM, submits it to the
active session, waits for the assistant reply, synthesizes it with xAI TTS,
and plays it back through `mpv`.

With **voice reply mode** ON (`Ctrl+Alt+C`), every assistant turn is
automatically spoken without pressing `Ctrl+Alt+\`.

## Commands

| Command | Keybind | Description |
|---|---|---|
| `/voice-record` | `ctrl+r` | Start/stop recording + transcribe (append to prompt) |
| `/voice-submit` | `leader+r` | Stop recording, transcribe, and submit prompt |
| `/voice-stop` | — | Cancel recording |
| `/voice-speak` | `leader+s` | Read last assistant response aloud (xAI TTS) |
| `/voice-mode` | `leader+v` | Toggle voice reply mode (auto-TTS every turn) |
| `/voice-stop-tts` | `escape` | Stop playback |
| — | `ctrl+alt+c` | Toggle voice reply mode (push-to-talk loop) |
| — | `ctrl+alt+/` | Start voice-chat recording |
| — | `ctrl+alt+\` | Stop recording, transcribe, submit, speak reply |

> **Note on keybinds.** `ctrl+r` (session rename) and `escape` are OpenCode
> defaults that this plugin reassigns. If another plugin or your config uses
> them, adjust `tui.json` `keybinds` accordingly. The commands themselves
> always work via slash commands; keybinds are conveniences.

> **Note on plugin API.** The plugin uses the legacy `api.command.register`
> TUI API (kept for v1 compatibility). On future OpenCode versions it may be
> migrated to `api.keymap.registerLayer`. The sidebar panel uses
> `api.slots.register` with the `sidebar_content` slot, which is the
> supported extension point.

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

The sidebar panel uses `createElement` + `spread` (the same primitives as the
`@opentui/solid` JSX runtime) so it renders without a JSX build step. It
requires a renderer context, which the slot registry provides at render time.

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
