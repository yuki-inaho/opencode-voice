import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { appendLedger, readLedger, summarizeLedger, ledgerPath } from "../lib/ledger.js";

function withLedgerDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ov-ledger-"));
  const file = path.join(dir, "ledger.jsonl");
  const prev = process.env.OPENCODE_VOICE_LEDGER;
  process.env.OPENCODE_VOICE_LEDGER = file;
  try {
    fn(file);
  } finally {
    if (prev === undefined) delete process.env.OPENCODE_VOICE_LEDGER;
    else process.env.OPENCODE_VOICE_LEDGER = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("ledgerPath uses env override", () => {
  process.env.OPENCODE_VOICE_LEDGER = "/tmp/ov-test.jsonl";
  assert.equal(ledgerPath(), "/tmp/ov-test.jsonl");
  delete process.env.OPENCODE_VOICE_LEDGER;
});

test("appendLedger then readLedger round-trips", () => {
  withLedgerDir((_file) => {
    appendLedger({ kind: "stt", model: "whisper-large-v3-turbo", audio_seconds: 15, cost_usd: 0.0002 });
    appendLedger({ kind: "tts", voice: "eve", chars: 50, cost_usd: 0.00075 });
    const entries = readLedger();
    assert.equal(entries.length, 2);
    assert.equal(entries[0].kind, "tts"); // newest first
    assert.equal(entries[1].kind, "stt");
  });
});

test("summarizeLedger aggregates by kind", () => {
  withLedgerDir((_file) => {
    appendLedger({ kind: "stt", audio_seconds: 15, cost_usd: 0.0002 });
    appendLedger({ kind: "stt", audio_seconds: 5, cost_usd: 0.0001 });
    appendLedger({ kind: "llm", cost_usd: 0.001 });
    appendLedger({ kind: "tts", chars: 100, cost_usd: 0.0015 });
    const s = summarizeLedger(readLedger());
    assert.equal(s.stt, 0.0003);
    assert.equal(s.llm, 0.001);
    assert.equal(s.tts, 0.0015);
    assert.equal(s.total, 0.0028);
    assert.equal(s.sttSeconds, 20);
    assert.equal(s.ttsChars, 100);
    assert.equal(s.count, 4);
  });
});

test("readLedger tolerates missing file", () => {
  process.env.OPENCODE_VOICE_LEDGER = "/nonexistent/dir/ledger.jsonl";
  assert.deepEqual(readLedger(), []);
  delete process.env.OPENCODE_VOICE_LEDGER;
});
