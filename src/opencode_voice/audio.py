"""Audio capture and playback helpers (16kHz mono PCM WAV)."""

from __future__ import annotations

import io
import wave

import numpy as np
import sounddevice as sd

from .config import AudioConfig


def record_utterance(cfg: AudioConfig) -> bytes | None:
    """Record until silence, returning WAV bytes (or None on no input)."""
    block = int(cfg.sample_rate * 0.2)  # 200ms blocks
    frames: list[np.ndarray] = []
    silent_blocks = 0
    max_blocks = int(cfg.max_record_s / 0.2)

    def stream_cb(indata, frames_out, time_info, status):
        pass  # not used; we read via blocking API below

    del stream_cb

    with sd.InputStream(
        samplerate=cfg.sample_rate,
        channels=cfg.channels,
        dtype="int16",
        device=cfg.input_device,
    ) as stream:
        print("🎙️  listening... (speak now)", flush=True)
        started = False
        for _ in range(max_blocks):
            data, _ = stream.read(block)
            samples = data[:, 0] if data.ndim > 1 else data
            rms = float(np.sqrt(np.mean(samples.astype(np.float32) ** 2))) / 32768.0

            if rms > cfg.vad_threshold:
                started = True
                silent_blocks = 0
            elif started:
                silent_blocks += 1

            if started:
                frames.append(samples.copy())

            if started and silent_blocks >= int(cfg.silence_timeout_s / 0.2):
                break

    if not frames:
        return None

    audio = np.concatenate(frames).astype(np.int16)
    return _to_wav(audio, cfg.sample_rate)


def _to_wav(samples: np.ndarray, sample_rate: int) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(samples.tobytes())
    return buf.getvalue()


def play_audio(data: bytes, extension: str, cfg: AudioConfig) -> None:
    """Decode audio (mp3/wav) and play through the default output device."""
    if extension == "wav":
        _play_wav(data, cfg)
    else:
        _play_mp3(data, cfg)


def _play_wav(data: bytes, cfg: AudioConfig) -> None:
    import io as _io
    import wave as _wave

    with _wave.open(_io.BytesIO(data), "rb") as w:
        rate = w.getframerate()
        channels = w.getnchannels()
        sample_width = w.getsampwidth()
        raw = w.readframes(w.getnframes())

    if sample_width == 2:
        dtype = np.int16
    elif sample_width == 1:
        dtype = np.int8
    elif sample_width == 4:
        dtype = np.int32
    else:
        raise RuntimeError(f"Unsupported sample width: {sample_width}")

    audio = np.frombuffer(raw, dtype=dtype).reshape(-1, channels) if channels > 1 else np.frombuffer(raw, dtype=dtype)
    sd.play(audio, samplerate=rate, device=cfg.output_device)
    sd.wait()


def _play_mp3(data: bytes, cfg: AudioConfig) -> None:
    """Decode MP3 via ffmpeg (if available) and play with sounddevice."""
    import subprocess
    import tempfile

    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
        f.write(data)
        tmp = f.name
    try:
        proc = subprocess.run(
            ["ffmpeg", "-i", tmp, "-f", "s16le", "-ac", "1", "-ar", str(cfg.sample_rate), "-"],
            capture_output=True,
            check=True,
        )
    except FileNotFoundError as e:
        raise RuntimeError("MP3 playback requires `ffmpeg` on PATH.") from e
    finally:
        import os

        os.unlink(tmp)

    audio = np.frombuffer(proc.stdout, dtype=np.int16)
    sd.play(audio, samplerate=cfg.sample_rate, device=cfg.output_device)
    sd.wait()
