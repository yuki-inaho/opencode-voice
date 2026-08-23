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

function textLine(content, fg = "gray", bold = false) {
  const el = createElement("text");
  spread(el, { fg, bold, children: content });
  return el;
}

export function VoiceCostsPanel() {
  const summary = useLedger();

  const box = createElement("box");
  spread(box, {
    children: [
      textLine(() => "Voice Costs", "cyan", true),
      textLine(() => `STT ${formatUsd(summary().stt)} (${summary().sttSeconds}s)`),
      textLine(() => `LLM ${formatUsd(summary().llm)}`),
      textLine(() => `TTS ${formatUsd(summary().tts)} (${summary().ttsChars} chars)`),
      textLine(() => `Total ${formatUsd(summary().total)}`, "white", true),
      textLine(() => `events: ${summary().count}`),
    ],
  });

  return box;
}
