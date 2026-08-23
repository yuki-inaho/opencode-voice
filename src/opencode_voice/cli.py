"""Command-line entry point for the voice conversation CLI."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from dotenv import load_dotenv

from .chat import run_conversation
from .config import load_config, summary


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="opencode-voice",
        description="Flexible voice conversation CLI (STT/LLM/TTS providers are configurable).",
    )
    parser.add_argument(
        "-c", "--config",
        type=Path,
        default=None,
        help="Path to config.yaml (default: ./config.yaml)",
    )
    parser.add_argument(
        "--show-config",
        action="store_true",
        help="Print the resolved provider configuration and exit.",
    )
    args = parser.parse_args()

    load_dotenv()

    cfg = load_config(args.config)
    if args.show_config:
        print(summary(cfg))
        return 0

    if not _api_keys_present(cfg):
        print(
            "Warning: some providers have no API key configured.\n"
            "Check the config or environment variables. Starting anyway...\n",
            file=sys.stderr,
        )

    return run_conversation(cfg)


def _api_keys_present(cfg) -> bool:
    keys = [cfg.stt.api_key, cfg.llm.api_key, cfg.tts.api_key]
    return all(keys)


if __name__ == "__main__":
    sys.exit(main())
