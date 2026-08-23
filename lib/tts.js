// Text-to-speech: xAI Grok TTS + mpv playback + cost ledger.
//
// Synthesis calls `POST https://api.x.ai/v1/tts` with XAI_API_KEY
// (Japanese supported). Audio is played through `mpv` with the
// Sound Blaster / default device. Each call appends a cost entry.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ttsCost } from "./costs.js";
import { appendLedger } from "./ledger.js";

const XAI_TTS_URL = "https://api.x.ai/v1/tts";
const DEFAULT_VOICE = "eve";
const DEFAULT_LANG = "ja";

function tmpAudioFile() {
  const dir = process.env.OPENCODE_VOICE_TMP || path.join(os.tmpdir());
  return path.join(dir, `opencode-voice-tts-${Date.now()}.mp3`);
}

/** Synthesize speech via xAI TTS, returning { file, cost, chars }. */
export async function synthesizeXai({ text, apiKey, voice = DEFAULT_VOICE, language = DEFAULT_LANG }) {
  if (!apiKey) throw new Error("XAI_API_KEY is required for TTS");
  if (!text || !text.trim()) throw new Error("No text to synthesize");

  const resp = await fetch(XAI_TTS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text, voice_id: voice, language }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`xAI TTS HTTP ${resp.status}: ${body}`);
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  const file = tmpAudioFile();
  fs.writeFileSync(file, buf);
  const cost = ttsCost(text);
  appendLedger({ kind: "tts", voice, language, chars: text.length, cost_usd: cost });
  return { file, cost, chars: text.length };
}

// ---- Playback ----

let playProc = null;

/** Play an audio file with mpv (falls back to ffplay). Resolves on finish. */
export function playAudio(file, { device } = {}) {
  return new Promise((resolve) => {
    const args = ["--no-video", "--volume=90", file];
    if (device) args.push("--audio-device=" + device);
    playProc = spawn("mpv", args, { stdio: "ignore" });
    playProc.on("close", () => {
      playProc = null;
      resolve();
    });
    playProc.on("error", () => {
      playProc = null;
      // Fallback to ffplay if mpv is unavailable.
      const fb = spawn("ffplay", ["-nodisp", "-autoexit", file], { stdio: "ignore" });
      fb.on("close", () => resolve());
      fb.on("error", () => resolve());
    });
  });
}

export function stopPlayback() {
  if (playProc) {
    try {
      playProc.kill("SIGKILL");
    } catch {}
    playProc = null;
  }
}
