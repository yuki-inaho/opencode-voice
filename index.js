// opencode-voice: Voice conversation plugin for OpenCode TUI.
//
// STT (Groq Whisper) + TTS (xAI Grok) + cost ledger + sidebar panel.
//
// Commands:
//   /voice-record (ctrl+r)  - start/stop recording + transcribe (append to prompt)
//   /voice-submit (leader+r)- stop recording + transcribe + submit prompt
//   /voice-stop             - cancel recording
//   /voice-speak (leader+s) - read last assistant response aloud (xAI TTS)
//   /voice-mode  (leader+v) - toggle auto TTS on/off
//   /voice-stop-tts (escape)- stop playback
//
// Options (tui.json plugin entry):
//   { "sttModel": "whisper-large-v3-turbo",
//     "ttsVoice": "eve", "ttsLanguage": "ja",
//     "llmEndpoint": "https://openrouter.ai/api/v1",
//     "llmModel": "deepseek/deepseek-v4-flash",
//     "llmApiKeyEnv": "OPENROUTER_API_KEY" }

import {
  startRecording,
  stopRecording,
  isRecording,
  cancelRecording,
  transcribeGroq,
  soxAvailable,
} from "./lib/stt.js";
import { synthesizeXai, playAudio, stopPlayback } from "./lib/tts.js";
import { createLlmClient } from "./lib/llm.js";
import { STT_SYSTEM_PROMPT, TTS_AUTO_SYSTEM_PROMPT, TTS_MANUAL_SYSTEM_PROMPT } from "./lib/prompts.js";
import { VoiceCostsPanel } from "./lib/panel.js";
import { createVoiceChat } from "./lib/voice-chat.js";

async function getTurnAssistantText(client, api) {
  const route = api.route.current;
  if (route.name !== "session") return null;
  const sessionID = route.params.sessionID;
  const stateMessages = api.state.session.messages(sessionID);
  if (!stateMessages || stateMessages.length === 0) return null;

  const assistantIDs = [];
  for (let i = stateMessages.length - 1; i >= 0; i--) {
    if (stateMessages[i].role === "user") break;
    if (stateMessages[i].role === "assistant") assistantIDs.unshift(stateMessages[i].id);
  }
  if (assistantIDs.length === 0) return null;

  const allText = [];
  for (const msgID of assistantIDs) {
    try {
      const full = await client.session.message({ sessionID, messageID: msgID }, { throwOnError: true });
      const textParts = (full.data?.parts || []).filter((p) => p.type === "text");
      const text = textParts.map((p) => p.text || "").join("\n\n").trim();
      if (text) allText.push(text);
    } catch (err) {
      console.error("[opencode-voice] failed to read message", msgID, err?.message);
    }
  }
  if (allText.length === 0) return null;
  return { lastMessageID: assistantIDs[assistantIDs.length - 1], text: allText.join("\n\n") };
}

export const OpenCodeVoice = {
  id: "opencode-voice",
  tui: async (api, options) => {
    const { kv } = api;

    async function log(scope, message, level = "debug") {
      try {
        await api.client.app.log({
          body: { service: "opencode-voice", level, message, extra: { scope } },
        });
      } catch {
        // Logging must never break the voice flow.
      }
    }

    const complete = createLlmClient(options || {}, { log });

    function toast(message, variant = "info") {
      api.ui.toast({ message, variant, duration: 3000 });
    }

    // ---- Voice chat mode (push-to-talk loop) ----
    const voiceChat = createVoiceChat({
      api,
      client: api.client,
      kv,
      complete,
      toast,
      log,
      options: options || {},
    });

    // ---- Voice reply mode + voice chat keybindings ----
    //   Ctrl+Alt+C  : toggle voice reply mode (auto-TTS every assistant turn)
    //   Ctrl+Alt+/  : start voice-chat recording
    //   Ctrl+Alt+\  : stop recording, transcribe, submit, and speak reply
    let offIdle = null;
    try {
      const layer = {
        bindings: [
          { key: "ctrl+alt+c", cmd: "voice.reply-mode.toggle" },
          { key: "ctrl+alt+/", cmd: "voice.chat.start" },
          { key: "ctrl+alt+\\", cmd: "voice.chat.send" },
        ],
        commands: [
          {
            name: "voice.reply-mode.toggle",
            run: () => {
              voiceChat.toggleReplyMode();
            },
          },
          {
            name: "voice.chat.start",
            run: () => {
              if (!soxAvailable()) {
                toast("sox not found on PATH - install sox first", "error");
                return;
              }
              voiceChat.startChat();
            },
          },
          {
            name: "voice.chat.send",
            run: () => {
              voiceChat.stopAndSend();
            },
          },
        ],
      };
      const offLayer = api.keymap.registerLayer(layer);
      offIdle = () => {
        if (typeof offLayer === "function") offLayer();
      };
    } catch (err) {
      log("keymap", `keymap registration failed: ${err.message}`, "error");
    }

    // ---- Voice reply mode: auto-TTS on session idle when enabled. ----
    const offReplyIdle = api.event.on("session.idle", async () => {
      if (!voiceChat.replyModeEnabled()) return;
      const result = await getTurnAssistantText(api.client, api);
      if (!result || !result.text) return;
      if (result.lastMessageID === voiceChat.lastSpokenID()) return;
      voiceChat.markSpoken(result.lastMessageID);
      await speakText(result.text, TTS_AUTO_SYSTEM_PROMPT);
    });

    // ---- Sidebar panel ----
    api.slots.register({
      order: 1000,
      slots: {
        sidebar_content(ctx, props) {
          void ctx;
          void props;
          return VoiceCostsPanel();
        },
      },
    });

    // ---- STT pipeline ----
    let sttBusy = false;

    async function doTranscribe(submit = false) {
      if (sttBusy) {
        toast("STT busy, please wait...");
        return;
      }
      sttBusy = true;
      try {
        const file = await stopRecording();
        toast("Transcribing...");
        const apiKey = process.env.GROQ_API_KEY;
        const { text, cost } = await transcribeGroq({
          model: options?.sttModel || "whisper-large-v3-turbo",
          apiKey,
          file,
        });
        if (!text) {
          toast("No speech detected", "warning");
          return;
        }

        toast("Normalizing...");
        const llm = await complete({ system: STT_SYSTEM_PROMPT, prompt: `Clean up this speech-to-text transcription:\n\n${text}` });
        const cleaned = llm.text || text;

        await api.client.tui.appendPrompt({ body: { text: cleaned } });
        toast(`STT ${cost ? `$${cost.toFixed(4)} ` : ""}transcribed`, "success");
        if (submit) await api.client.tui.submitPrompt();
      } catch (err) {
        log("STT", `transcribe failed: ${err.message}`, "error");
        toast(`STT error: ${err.message}`, "error");
      } finally {
        sttBusy = false;
      }
    }

    // ---- TTS pipeline ----
    async function speakText(text, systemPrompt) {
      if (!text) return;
      toast("Normalizing response...");
      const llm = await complete({ system: systemPrompt, prompt: `Convert for text-to-speech:\n\n${text}` });
      if (!llm.text) {
        log("TTS", `normalization failed: ${llm.error || "no text"}`, "warn");
        toast(`TTS normalization failed: ${llm.error || "no text"}`, "warning");
        return;
      }
      toast("Synthesizing speech...");
      try {
        const { file, cost } = await synthesizeXai({
          text: llm.text,
          apiKey: process.env.XAI_API_KEY,
          voice: options?.ttsVoice || "eve",
          language: options?.ttsLanguage || "ja",
        });
        toast(`TTS ${cost ? `$${cost.toFixed(4)} ` : ""}playing`);
        await playAudio(file);
      } catch (err) {
        log("TTS", `synthesis failed: ${err.message}`, "error");
        toast(`TTS error: ${err.message}`, "error");
      }
    }

    async function speakLastResponse(manual = false) {
      const result = await getTurnAssistantText(api.client, api);
      if (!result || !result.text) {
        toast("No assistant response to speak", "warning");
        return;
      }
      await speakText(result.text, manual ? TTS_MANUAL_SYSTEM_PROMPT : TTS_AUTO_SYSTEM_PROMPT);
    }

    // ---- Commands ----
    api.command.register(() => [
      {
        title: "Voice: record/transcribe",
        value: "voice.record",
        description: "Toggle recording; press again to transcribe via Groq",
        keybind: "ctrl+r",
        slash: { name: "voice-record" },
        onSelect() {
          if (!soxAvailable()) {
            toast("sox not found on PATH - install sox first", "error");
            return;
          }
          if (isRecording()) {
            toast("Stopping, transcribing...");
            doTranscribe(false);
          } else {
            startRecording();
            toast("Recording... press again to transcribe");
          }
        },
      },
      {
        title: "Voice: submit recording",
        value: "voice.submit",
        description: "Stop recording, transcribe, and submit prompt",
        keybind: "<leader>r",
        slash: { name: "voice-submit" },
        onSelect() {
          if (!soxAvailable()) {
            toast("sox not found on PATH - install sox first", "error");
            return;
          }
          if (!isRecording()) {
            toast("No recording in progress", "warning");
            return;
          }
          toast("Stopping, transcribing...");
          doTranscribe(true);
        },
      },
      {
        title: "Voice: cancel recording",
        value: "voice.stop",
        description: "Cancel current recording",
        slash: { name: "voice-stop" },
        onSelect() {
          cancelRecording();
          toast("Recording cancelled");
        },
      },
      {
        title: "Voice: speak last response",
        value: "voice.speak-last",
        description: "Read last assistant response aloud (xAI TTS)",
        keybind: "<leader>s",
        slash: { name: "voice-speak" },
        onSelect() {
          speakLastResponse(true);
        },
      },
      {
        title: "Voice: toggle reply mode",
        value: "voice.reply-mode",
        description: "Toggle voice reply mode (auto-TTS every assistant turn)",
        keybind: "<leader>v",
        slash: { name: "voice-mode" },
        onSelect() {
          const next = voiceChat.toggleReplyMode();
          toast(next === "on" ? "Voice reply mode ON" : "Voice reply mode OFF");
        },
      },
      {
        title: "Voice: stop playback",
        value: "voice.stop-tts",
        description: "Stop current TTS playback",
        keybind: "escape",
        slash: { name: "voice-stop-tts" },
        onSelect() {
          stopPlayback();
          toast("Playback stopped");
        },
      },
    ]);

    api.lifecycle?.onDispose?.(() => {
      stopPlayback();
      cancelRecording();
      if (typeof offIdle === "function") offIdle();
      if (typeof offReplyIdle === "function") offReplyIdle();
    });
  },
};

export default OpenCodeVoice;
