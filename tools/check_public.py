#!/usr/bin/env python3
"""Fail if the public checkout contains extra audio, data dumps or likely secrets."""
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from decide_benchmark.data import Dataset


def main():
    dataset = Dataset(ROOT / "site/preview")
    dataset.verify()
    assert len(dataset.questions) == 6
    expected = {"site/preview/" + q["audio"] for q in dataset.questions}
    public_audio = {p.relative_to(ROOT).as_posix() for p in (ROOT / "site").rglob("*") if p.suffix.lower() in {".wav", ".mp3", ".flac", ".m4a", ".ogg"}}
    assert public_audio == expected, "Public audio must be exactly the six allowlisted previews"
    names = subprocess.check_output(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=ROOT).decode().split("\0")
    forbidden = re.compile(r"(^|/)(\.env(?:\..+)?|annotations.*|ground_truth.*|requests\.jsonl|results\.jsonl|.*\.sqlite3?|.*\.csv)$")
    secrets = re.compile(r"(?:hf_[A-Za-z0-9]{25,}|vercel_[A-Za-z0-9]{20,}|postgres(?:ql)?://[^\s]+|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,})")
    for name in filter(None, names):
        if name.startswith(("data/", "private/", "runs/")):
            raise ValueError(f"Private data/output directory included in public checkout: {name}")
        if name.endswith(".jsonl") and name not in {"site/preview/questions.jsonl", "site/preview/answers.jsonl"}:
            raise ValueError(f"Non-preview question, answer or prediction file included: {name}")
        if name != ".env.example" and forbidden.search(name):
            raise ValueError(f"Private-looking file in public checkout: {name}")
        path = ROOT / name
        if path.suffix.lower() in {".wav", ".mp3", ".flac", ".m4a", ".ogg"} and name not in expected:
            raise ValueError("Additional audio outside the public preview")
        if path.is_file() and path.suffix.lower() not in {".wav", ".png", ".jpg"}:
            text = path.read_text(errors="ignore")
            if secrets.search(text):
                raise ValueError(f"Credential pattern detected: {name}")
            if "/Volumes/" in text or "/Users/" in text:
                # The scanner itself contains these patterns by necessity.
                if name != "tools/check_public.py":
                    raise ValueError(f"Private absolute path detected: {name}")
    print("Public-content check passed: exactly six preview questions/clips; no private dumps or credential patterns.")


if __name__ == "__main__":
    main()
