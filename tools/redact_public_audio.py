#!/usr/bin/env python3
"""Replace reviewed PCM spans with a tone; source recordings stay outside this repo."""
from __future__ import annotations

import argparse
from array import array
import hashlib
import io
import json
import math
from pathlib import Path
import sys
import wave


ROOT = Path(__file__).resolve().parents[1]


def redact_wav(data, spans, *, tone_hz=1000, amplitude=0.12, fade_ms=5):
    with wave.open(io.BytesIO(data), "rb") as source:
        params = source.getparams()
        if (params.nchannels, params.sampwidth, params.framerate, params.comptype) != (1, 2, 16000, "NONE"):
            raise ValueError("Expected mono 16 kHz PCM16 WAV")
        pcm = array("h", source.readframes(params.nframes))
    if sys.byteorder != "little":
        pcm.byteswap()
    if not (math.isfinite(tone_hz) and 0 < tone_hz < params.framerate / 2
            and math.isfinite(amplitude) and 0 < amplitude < 1
            and math.isfinite(fade_ms) and fade_ms >= 0):
        raise ValueError("Invalid tone settings")
    last = 0
    for span in spans:
        start, end = span["start_seconds"], span["end_seconds"]
        if not (math.isfinite(start) and math.isfinite(end)
                and 0 <= start < end <= params.nframes / params.framerate):
            raise ValueError("Invalid redaction interval")
        first, stop = math.floor(start * params.framerate), math.ceil(end * params.framerate)
        if first < last:
            raise ValueError("Redaction intervals must be ordered and non-overlapping")
        size = stop - first
        fade = min(round(fade_ms * params.framerate / 1000), size // 2)
        for offset in range(size):
            envelope = min(1.0, offset / fade, (size - 1 - offset) / fade) if fade else 1.0
            # Replace every source sample, including during the tone's fade.
            pcm[first + offset] = round(32767 * amplitude * envelope
                                       * math.sin(2 * math.pi * tone_hz * offset / params.framerate))
        last = stop
    if sys.byteorder != "little":
        pcm.byteswap()
    result = io.BytesIO()
    with wave.open(result, "wb") as target:
        target.setparams(params)
        target.writeframes(pcm.tobytes())
    return result.getvalue()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-audio", type=Path, required=True,
                        help="Private directory containing original example-XX.wav files")
    parser.add_argument("--output-audio", type=Path, required=True)
    parser.add_argument("--plan", type=Path, default=ROOT / "site/preview/redactions.json")
    args = parser.parse_args()
    source, output = args.source_audio.resolve(), args.output_audio.resolve()
    if source == output:
        parser.error("Source and destination must differ")
    if ROOT == source or ROOT in source.parents:
        parser.error("Original audio must be kept outside the public checkout")
    plan = json.loads(args.plan.read_text())
    # Verify all input hashes before writing any destination audio.
    inputs = {}
    for clip in plan["clips"]:
        data = (source / f"{clip['id']}.wav").read_bytes()
        if hashlib.sha256(data).hexdigest() != clip["source_audio_sha256"]:
            raise ValueError(f"Original source hash differs for {clip['id']}")
        inputs[clip["id"]] = data
    output.mkdir(parents=True, exist_ok=True)
    for clip in plan["clips"]:
        data = inputs[clip["id"]]
        if clip["spans"]:
            data = redact_wav(data, clip["spans"], **plan["tone"])
        (output / f"{clip['id']}.wav").write_bytes(data)
        print(f"{clip['id']}: {len(clip['spans'])} replacement span(s)")


if __name__ == "__main__":
    main()
