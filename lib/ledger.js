// Cost ledger: append-only JSONL file recording every STT/LLM/TTS cost event.
//
// Path is resolved independent of the working directory:
//   $OPENCODE_VOICE_LEDGER  (explicit override)
//   else ~/.local/share/opencode-voice/ledger.jsonl
// This avoids the startup-directory dependency of the earlier Python/pixi version.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function ledgerPath() {
  if (process.env.OPENCODE_VOICE_LEDGER) return process.env.OPENCODE_VOICE_LEDGER;
  return path.join(os.homedir(), ".local", "share", "opencode-voice", "ledger.jsonl");
}

/** Append one cost event to the ledger (never throws on disk errors). */
export function appendLedger(entry) {
  const file = ledgerPath();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      ...entry,
    });
    fs.appendFileSync(file, line + "\n", "utf8");
  } catch {
    // Recording cost history must never break the voice flow.
  }
}

/** Read all ledger entries (newest first). Returns [] on any error. */
export function readLedger() {
  const file = ledgerPath();
  try {
    if (!fs.existsSync(file)) return [];
    const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
    const entries = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line));
      } catch {
        // Skip malformed lines.
      }
    }
    return entries.reverse();
  } catch {
    return [];
  }
}

/** Aggregate ledger entries into a session summary. */
export function summarizeLedger(entries) {
  let stt = 0;
  let llm = 0;
  let tts = 0;
  let sttSeconds = 0;
  let ttsChars = 0;
  for (const e of entries) {
    if (e.kind === "stt") {
      stt += e.cost_usd ?? 0;
      sttSeconds += e.audio_seconds ?? 0;
    } else if (e.kind === "llm") {
      llm += e.cost_usd ?? 0;
    } else if (e.kind === "tts") {
      tts += e.cost_usd ?? 0;
      ttsChars += e.chars ?? 0;
    }
  }
  return {
    stt: round(stt),
    llm: round(llm),
    tts: round(tts),
    total: round(stt + llm + tts),
    sttSeconds: Math.round(sttSeconds),
    ttsChars,
    count: entries.length,
  };
}

function round(value, digits = 8) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
