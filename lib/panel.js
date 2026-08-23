// SolidJS sidebar panel showing live voice cost totals.
//
// Renders into the `sidebar_content` slot of the OpenCode TUI.
// Uses `createElement` + `spread` (the same primitives the @opentui/solid
// JSX runtime uses), so signal updates propagate without a JSX step.
// These primitives require an active renderer context, which the slot
// registry provides when it renders this panel.

import { createEffect, createSignal, onCleanup } from "solid-js";
import { createElement, spread } from "@opentui/solid";

import { formatUsd } from "./costs.js";
import { readLedger, summarizeLedger } from "./ledger.js";

function useLedger(refreshMs = 2000) {
  const [summary, setSummary] = createSignal(summarizeLedger([]));
  let timer = null;

  function refresh() {
    setSummary(summarizeLedger(readLedger()));
  }

  createEffect(() => {
    refresh();
    timer = setInterval(refresh, refreshMs);
    onCleanup(() => {
      if (timer) clearInterval(timer);
    });
  });

  return summary;
}

function useReplyMode(kv, refreshMs = 1000) {
  const [enabled, setEnabled] = createSignal(false);
  let timer = null;

  function refresh() {
    setEnabled(kv?.get("voice.replyMode", "off") === "on");
  }

  createEffect(() => {
    refresh();
    timer = setInterval(refresh, refreshMs);
    onCleanup(() => {
      if (timer) clearInterval(timer);
    });
  });

  return enabled;
}

function textLine(content, fg = "gray", bold = false) {
  const el = createElement("text");
  spread(el, { fg, bold, children: content });
  return el;
}

export function VoiceCostsPanel({ kv } = {}) {
  const summary = useLedger();
  const replyMode = useReplyMode(kv);

  const box = createElement("box");
  spread(box, {
    children: [
      textLine(() => "Voice", "cyan", true),
      textLine(
        () => `Reply mode: ${replyMode() ? "ON" : "OFF"}`,
        replyMode() ? "green" : "gray",
        true,
      ),
      textLine(() => "--- Costs ---", "gray"),
      textLine(() => `STT ${formatUsd(summary().stt)} (${summary().sttSeconds}s)`),
      textLine(() => `LLM ${formatUsd(summary().llm)}`),
      textLine(() => `TTS ${formatUsd(summary().tts)} (${summary().ttsChars} chars)`),
      textLine(() => `Total ${formatUsd(summary().total)}`, "white", true),
    ],
  });

  return box;
}
