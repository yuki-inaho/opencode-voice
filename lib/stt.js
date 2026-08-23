// Speech-to-text: sox recording + Groq Whisper transcription + cost ledger.
//
// Recording uses `sox` (16kHz mono WAV). Transcription calls the Groq
// OpenAI-compatible `/audio/transcriptions` endpoint with GROQ_API_KEY.
// Each successful call appends a cost entry to the ledger.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { sttCost } from "./costs.js";
import { appendLedger } from "./ledger.js";

const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const DEFAULT_MODEL = "whisper-large-v3-turbo";

function wavFile() {
  const dir = process.env.OPENCODE_VOICE_TMP || path.join(os.tmpdir());
  return path.join(dir, "opencode-voice-stt.wav");
}

function secondsFromWav(file) {
  try {
    const buf = fs.readFileSync(file);
    if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF") return 0;
    // Walk RIFF chunks to find the "data" chunk (ffmpeg may insert LIST etc.).
    let offset = 12;
    let rate = 0;
    let dataSize = 0;
    while (offset + 8 <= buf.length) {
      const id = buf.toString("ascii", offset, offset + 4);
      const size = buf.readUInt32LE(offset + 4);
      if (id === "fmt ") {
        rate = buf.readUInt32LE(offset + 8 + 4);
      } else if (id === "data") {
        dataSize = size;
        break;
      }
      offset += 8 + size + (size % 2); // chunks are word-aligned
    }
    if (rate <= 0 || dataSize <= 0) return 0;
    return dataSize / rate;
  } catch {
    return 0;
  }
}

/** Transcribe a WAV file via Groq, returning { text, cost, audioSeconds }. */
export async function transcribeGroq({ model = DEFAULT_MODEL, apiKey, file }) {
  const audioSeconds = file ? secondsFromWav(file) : 0;
  if (!apiKey) throw new Error("GROQ_API_KEY is required for STT");
  if (!file || !fs.existsSync(file)) throw new Error("No recording file to transcribe");

  const buf = fs.readFileSync(file);
  const form = new FormData();
  form.append("file", new Blob([buf], { type: "audio/wav" }), "input.wav");
  form.append("model", model);
  form.append("response_format", "json");

  const resp = await fetch(GROQ_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Groq STT HTTP ${resp.status}: ${body}`);
  }
  const data = await resp.json();
  const text = (data.text || "").trim();
  const cost = sttCost(model, audioSeconds);
  appendLedger({ kind: "stt", model, audio_seconds: audioSeconds, cost_usd: cost, chars: text.length });
  return { text, cost, audioSeconds };
}

// ---- Recording ----

let soxProc = null;
let recording = false;

function forceKillSox() {
  if (soxProc) {
    try {
      process.kill(soxProc.pid, "SIGKILL");
    } catch {}
    soxProc = null;
  }
  try {
    spawn("pkill", ["-9", "-f", "opencode-voice-stt"]);
  } catch {}
}

/** Start sox recording. Returns true if recording began. */
export function startRecording() {
  if (soxProc) return false;
  const file = wavFile();
  forceKillSox();
  try {
    fs.unlinkSync(file);
  } catch {}

  soxProc = spawn(
    "sox",
    ["-d", "-r", "16000", "-c", "1", "-b", "16", file, "silence", "1", "0.2", "2%"],
    { stdio: "ignore" },
  );
  soxProc.on("exit", (code) => {
    // code 127 = binary not found. Leave soxProc null so a later retry works.
    if (code === 127) soxProc = null;
    soxProc = null;
  });
  soxProc.on("error", () => {
    soxProc = null;
  });
  recording = true;
  return true;
}

/** Stop recording and wait for sox to finish. */
export async function stopRecording() {
  if (soxProc) soxProc.kill("SIGINT");
  const start = Date.now();
  while (soxProc && Date.now() - start < 2000) {
    await new Promise((r) => setTimeout(r, 50));
  }
  if (soxProc) forceKillSox();
  recording = false;
  return wavFile();
}

export function isRecording() {
  return recording;
}

export function cancelRecording() {
  if (recording) {
    recording = false;
    forceKillSox();
  }
}

/** Return true when the `sox` binary is available on PATH. */
export function soxAvailable() {
  try {
    const r = spawnSync("sox", ["--version"], { stdio: "ignore" });
    return r.status === 0;
  } catch {
    return false;
  }
}
