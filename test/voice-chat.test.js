import { test } from "node:test";
import assert from "node:assert/strict";

import { createVoiceChat } from "../lib/voice-chat.js";

function makeDeps(overrides = {}) {
  const kvStore = new Map([["voice.replyMode", "off"]]);
  const kv = {
    get: (k, f) => (kvStore.has(k) ? kvStore.get(k) : f),
    set: (k, v) => kvStore.set(k, v),
  };
  const toasts = [];
  const logs = [];
  const toast = (msg, variant) => toasts.push({ msg, variant });
  const log = (scope, message, level) => logs.push({ scope, message, level });

  const stt = {
    isRecording: () => false,
    startRecording: () => {},
    stopRecording: async () => "/tmp/test.wav",
  };

  const deps = {
    api: { route: { current: { name: "session", params: { sessionID: "s1" } } } },
    client: {
      tui: {
        appendPrompt: async ({ body }) => ({ ok: true, text: body.text }),
        submitPrompt: async () => ({ ok: true }),
      },
      session: {
        messages: async () => ({
          data: [
            { info: { role: "user", id: "u1" }, parts: [{ type: "text", text: "hi" }] },
            { info: { role: "assistant", id: "a1" }, parts: [{ type: "text", text: "こんにちは" }] },
          ],
        }),
      },
    },
    kv,
    complete: async () => ({ text: "cleaned" }),
    toast,
    log,
    options: {},
    stt,
    ...overrides,
  };
  return { deps, kvStore, toasts, logs };
}

test("reply mode toggles off->on", () => {
  const { deps } = makeDeps();
  const vc = createVoiceChat(deps);
  assert.equal(vc.replyModeEnabled(), false);
  const next = vc.toggleReplyMode();
  assert.equal(next, "on");
  assert.equal(vc.replyModeEnabled(), true);
});

test("toggleReplyMode toasts the new state", () => {
  const { deps, toasts } = makeDeps();
  const vc = createVoiceChat(deps);
  vc.toggleReplyMode();
  assert.ok(toasts.some((t) => t.msg.includes("ON")));
});

test("startChat starts recording when idle", async () => {
  const { deps, toasts } = makeDeps();
  const vc = createVoiceChat(deps);
  const started = await vc.startChat();
  assert.equal(started, true);
  assert.ok(toasts.some((t) => t.msg.includes("Recording")));
});

test("startChat returns false when already recording", async () => {
  const { deps } = makeDeps();
  deps.stt.isRecording = () => true;
  const vc = createVoiceChat(deps);
  const started = await vc.startChat();
  assert.equal(started, false);
});

test("activeSessionID resolves from route", () => {
  const { deps } = makeDeps();
  const vc = createVoiceChat(deps);
  assert.equal(vc.activeSessionID(), "s1");
});

test("lastAssistantText parses SDK messages shape", async () => {
  const { deps } = makeDeps();
  const vc = createVoiceChat(deps);
  const last = await vc.lastAssistantText("s1");
  assert.ok(last);
  assert.equal(last.messageID, "a1");
  assert.equal(last.text, "こんにちは");
});
