"""Turn-based voice conversation loop.

Pipeline: record -> STT -> LLM -> TTS -> playback, with conversation history.
Each turn prints the per-call cost and a running session total.
"""

from __future__ import annotations

from dataclasses import dataclass

from .audio import play_audio, record_utterance
from .config import Config
from .costs import CostEstimate
from .llm import chat
from .stt import transcribe
from .tts import synthesize


@dataclass
class SessionCosts:
    stt: float = 0.0
    llm: float = 0.0
    tts: float = 0.0

    @property
    def total(self) -> float:
        return self.stt + self.llm + self.tts

    def add_stt(self, cost: CostEstimate) -> None:
        self.stt += cost.usd

    def add_llm(self, cost: CostEstimate) -> None:
        self.llm += cost.usd

    def add_tts(self, cost: CostEstimate) -> None:
        self.tts += cost.usd


def run_conversation(cfg: Config) -> int:
    """Run an interactive voice conversation until the user quits."""
    history: list[dict] = [
        {"role": "system", "content": cfg.conversation.system_prompt}
    ]
    costs = SessionCosts()

    print("Voice conversation started. Say something, or 'quit' / 'bye' to exit.\n")
    print(_provider_summary(cfg))
    print("Press Ctrl+C to stop.\n")

    try:
        while True:
            wav = record_utterance(cfg.audio)
            if wav is None:
                print("(no input detected)\n")
                continue

            try:
                stt_result = transcribe(cfg.stt, wav)
            except Exception as e:  # noqa: BLE001 - surface provider errors to user
                print(f"[STT error] {e}\n")
                continue

            user_text = stt_result.text.strip()
            if not user_text:
                print("(could not understand)\n")
                continue

            costs.add_stt(stt_result.cost)
            print(f"You: {user_text}")
            print(f"  [STT] {stt_result.cost}  (session STT total: ${costs.stt:.4f})")
            if _is_quit(user_text):
                print("Goodbye!")
                break

            history.append({"role": "user", "content": user_text})
            history = history[-cfg.conversation.history_limit :]

            try:
                llm_result = chat(cfg.llm, history, cfg.conversation.max_tokens)
            except Exception as e:  # noqa: BLE001
                print(f"[LLM error] {e}\n")
                history.pop()
                continue

            history.append({"role": "assistant", "content": llm_result.text})
            costs.add_llm(llm_result.cost)
            print(f"AI: {llm_result.text}")
            print(f"  [LLM] {llm_result.cost}  (session LLM total: ${costs.llm:.4f})")

            try:
                tts_result = synthesize(cfg.tts, llm_result.text)
            except Exception as e:  # noqa: BLE001
                print(f"[TTS error] {e}\n")
                continue

            costs.add_tts(tts_result.cost)
            print(f"  [TTS] {tts_result.cost}  (session TTS total: ${costs.tts:.4f})")

            play_audio(tts_result.data, tts_result.extension, cfg.audio)
            print(f"  [Session total] ${costs.total:.4f}")
            print()
    except KeyboardInterrupt:
        print("\nStopped.")
    print(f"\nSession cost summary: STT ${costs.stt:.4f} + LLM ${costs.llm:.4f} + TTS ${costs.tts:.4f} = ${costs.total:.4f}")
    return 0


def _is_quit(text: str) -> bool:
    t = text.lower().strip(" .!?。！？")
    return t in {"quit", "bye", "exit", "終了", "さようなら", "バイバイ"}


def _provider_summary(cfg: Config) -> str:
    from .config import summary

    return summary(cfg)
