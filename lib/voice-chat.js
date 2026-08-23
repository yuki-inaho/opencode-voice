// Voice chat mode: push-to-talk conversation loop.
//
// Workflow driven by two keybindings (registered in index.js):
//   1. start -> begin sox recording
//   2. stop  -> stop recording, Groq STT -> send to the active OpenCode
//               session via the SDK, then synthesize the assistant reply
//               with xAI TTS and play it back.
//
// "Voice reply mode" (Ctrl+Alt+C) is a separate toggle that makes every
// assistant turn auto-play through TTS (handled in index.js via session.idle).

import { transcribeGroq } from "./stt.js";
import { synthesizeXai, playAudio } from "./tts.js";
import { STT_SYSTEM_PROMPT } from "./prompts.js";

/**
 * Create the voice-chat controller.
 *
 * @param {object} deps
 * @param {object} deps.api    - TUI plugin api (for route access)
 * @param {object} deps.client - OpenCode SDK client (api.client)
 * @param {object} deps.kv    - key-value store (api.kv)
 * @param {Function} deps.complete - LLM completion (STT normalization)
 * @param {Function} deps.toast - UI toast
 * @param {Function} deps.log - structured logger
 * @param {object} deps.options - plugin options
 * @param {object} deps.stt - optional stt module override (for tests)
 */
export function createVoiceChat({ api, client, kv, complete, toast, log, options = {}, stt }) {
  const sttMod = stt ?? null;
  let busy = false;
  let lastSpokenMessageID = null;

  async function sttModule() {
    return sttMod || (await import("./stt.js"));
  }

  function replyModeEnabled() {
    return kv.get("voice.replyMode", "off") === "on";
  }

  function toggleReplyMode() {
    const next = replyModeEnabled() ? "off" : "on";
    kv.set("voice.replyMode", next);
    toast(next === "on" ? "Voice reply mode ON" : "Voice reply mode OFF");
    return next;
  }

  async function startChat() {
    if (busy) {
      toast("Voice chat busy, please wait...", "warning");
      return false;
    }
    const mod = await sttModule();
    const { startRecording, isRecording } = mod;
    if (isRecording()) {
      toast("Already recording", "warning");
      return false;
    }
    startRecording();
    toast("🎙️ Recording... press Ctrl+Alt+\\ to send");
    return true;
  }

  async function stopAndSend() {
    const mod = await sttModule();
    const { stopRecording, isRecording } = mod;
    if (!isRecording()) {
      toast("Not recording", "warning");
      return;
    }
    if (busy) {
      toast("Voice chat busy, please wait...", "warning");
      return;
    }
    busy = true;
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
      toast(`Heard: ${text.slice(0, 60)}`);

      // Normalize the transcription (fix homophones/punctuation).
      const norm = await complete({
        system: STT_SYSTEM_PROMPT,
        prompt: `Clean up this speech-to-text transcription:\n\n${text}`,
      });
      const cleaned = (norm && norm.text) || text;
      log("voice", `transcribed "${cleaned}" cost=${cost}`, "info");

      // Snapshot the current newest assistant message id BEFORE submitting,
      // so speakPendingReply only plays a genuinely new reply.
      const before = await newestAssistantMessageID(activeSessionID());

      // Send the transcribed text as a prompt to the active session.
      await client.tui.appendPrompt({ body: { text: cleaned } });
      await client.tui.submitPrompt();

      // Wait for a reply newer than `before` and speak it.
      await speakPendingReply({ newerThan: before });
    } catch (err) {
      log("voice", `chat error: ${err.message}`, "error");
      toast(`Voice chat error: ${err.message}`, "error");
    } finally {
      busy = false;
    }
  }

  /** Return the newest assistant message id in the session, or null. */
  async function newestAssistantMessageID(sessionID) {
    if (!sessionID) return null;
    const last = await lastAssistantText(sessionID);
    return last ? last.messageID : null;
  }

  /** Poll the session for a reply newer than `newerThan` and play it. */
  async function speakPendingReply({ newerThan = null, timeoutMs = 60000, pollMs = 1000 } = {}) {
    const started = Date.now();
    const sessionID = activeSessionID();
    if (!sessionID) {
      toast("No active session", "warning");
      return;
    }
    while (Date.now() - started < timeoutMs) {
      const last = await lastAssistantText(sessionID);
      if (last && last.messageID !== lastSpokenMessageID && last.messageID !== newerThan) {
        lastSpokenMessageID = last.messageID;
        await speakText(last.text);
        return;
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
    toast("No assistant reply within timeout", "warning");
  }

  async function lastAssistantText(sessionID) {
    try {
      const msgs = await client.session.messages({ path: { id: sessionID } }, { throwOnError: true });
      const list = msgs?.data ?? msgs ?? [];
      for (let i = list.length - 1; i >= 0; i--) {
        const item = list[i];
        if (item?.info?.role === "user") break;
        if (item?.info?.role !== "assistant") continue;
        const parts = item.parts || [];
        const text = parts
          .filter((p) => p.type === "text")
          .map((p) => p.text || "")
          .join("\n\n")
          .trim();
        if (text) return { messageID: item.info.id, text };
      }
      return null;
    } catch {
      return null;
    }
  }

  function activeSessionID() {
    try {
      const route = api?.route?.current;
      return route?.name === "session" ? route.params.sessionID : null;
    } catch {
      return null;
    }
  }

  async function speakText(text) {
    try {
      toast("Synthesizing reply...");
      const { file, cost } = await synthesizeXai({
        text,
        apiKey: process.env.XAI_API_KEY,
        voice: options?.ttsVoice || "eve",
        language: options?.ttsLanguage || "ja",
      });
      log("voice", `synthesized reply cost=${cost}`, "info");
      toast(`Speaking reply ($${cost.toFixed(4)})`);
      await playAudio(file);
    } catch (err) {
      log("voice", `TTS error: ${err.message}`, "error");
      toast(`TTS error: ${err.message}`, "error");
    }
  }

  /** Record a message id as already spoken (dedup across modes). */
  function markSpoken(messageID) {
    lastSpokenMessageID = messageID;
  }

  /** Return the last message id that was spoken (or null). */
  function lastSpokenID() {
    return lastSpokenMessageID;
  }

  return {
    replyModeEnabled,
    toggleReplyMode,
    startChat,
    stopAndSend,
    speakPendingReply,
    activeSessionID,
    lastAssistantText,
    markSpoken,
    lastSpokenID,
  };
}
