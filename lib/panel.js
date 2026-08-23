// SolidJS sidebar panel showing live voice cost totals.
//
// Renders into the `sidebar_content` slot of the OpenCode TUI.
// Uses `baseComponents` + `createComponent` directly (no JSX) so the plugin
// loads without a JSX transpilation step. Reads the cost ledger on an
// interval and displays STT/LLM/TTS totals plus session aggregate.

import { createEffect, createSignal, onCleanup } from "solid-js";
import { baseComponents } from "@opentui/solid";

import { formatUsd } from "./costs.js";
import { readLedger, summarizeLedger } from "./ledger.js";

const { text: Text, box: Box } = baseComponents;

function TextLine({ children, fg }) {
  return Text({ fg: fg ?? "white", children });
}

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

export function VoiceCostsPanel() {
  const summary = useLedger();
  const s = () => summary();

  return Box({
    children: [
      TextLine({ fg: "cyan", children: "Voice Costs" }),
      TextLine({
        fg: "gray",
        children: `STT ${formatUsd(s().stt)} (${s().sttSeconds}s)`,
      }),
      TextLine({ fg: "gray", children: `LLM ${formatUsd(s().llm)}` }),
      TextLine({
        fg: "gray",
        children: `TTS ${formatUsd(s().tts)} (${s().ttsChars} chars)`,
      }),
      TextLine({ fg: "white", children: `Total ${formatUsd(s().total)}` }),
      TextLine({ fg: "gray", children: `events: ${s().count}` }),
    ],
  });
}
