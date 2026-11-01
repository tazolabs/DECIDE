"""Versioned question inputs and private reference labels, loaded separately."""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
import math
from pathlib import Path
import wave


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_REPO = "tazolabs/DECIDE"
DEFAULT_REVISION = "v1.0"


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False).encode()).hexdigest()


def file_sha(path):
    with path.open("rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()


def read_jsonl(path, *, key="id"):
    rows, seen = [], set()
    with Path(path).open(encoding="utf-8") as f:
        for number, line in enumerate(f, 1):
            if not line.strip():
                continue
            value = json.loads(line)
            if not isinstance(value, dict) or not isinstance(value.get(key), str) or not value[key]:
                raise ValueError(f"{Path(path).name}:{number}: expected an object with a nonempty {key}")
            if value[key] in seen:
                raise ValueError(f"Duplicate {key}: {value[key]}")
            seen.add(value[key])
            rows.append(value)
    return rows


def contained_file(root, relative):
    if not isinstance(relative, str) or Path(relative).is_absolute():
        raise ValueError("Dataset paths must be relative")
    root = Path(root).resolve()
    path = (root / relative).resolve()
    if root not in path.parents or not path.is_file():
        raise ValueError("Missing file or path escapes dataset directory")
    return path


class Dataset:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.manifest = json.loads(contained_file(self.root, "manifest.json").read_text())
        if self.manifest.get("schema_version") != 1:
            raise ValueError("Unsupported DECIDE schema version")
        self.questions = read_jsonl(contained_file(self.root, "questions.jsonl"))
        self.by_id = {q["id"]: q for q in self.questions}
        self.fingerprint = digest(self.manifest)
        self._validate_questions()

    def _validate_questions(self):
        for q in self.questions:
            if any(k in q for k in ("label", "accepted_labels", "gold", "reference_answer", "reviewer_notes")):
                raise ValueError("Reference labels/reviewer notes must not be in model inputs")
            if not isinstance(q.get("duration_seconds"), (int, float)) or not math.isfinite(q["duration_seconds"]) or q["duration_seconds"] <= 0:
                raise ValueError("Invalid clip duration")
            for mode in ("audio", "text"):
                request = q[f"{mode}_request"]
                if set(request) != {"state", "questions"} or set(request["questions"]) != {"action"}:
                    raise ValueError("Expected state and one action question")
                question = request["questions"]["action"]
                if question.get("type") != "choice" or not isinstance(question.get("instructions"), str):
                    raise ValueError("Expected a choice question with instructions")
                criteria = question.get("criteria")
                if not isinstance(criteria, dict) or len(criteria) < 2 or any(not isinstance(k, str) or not k or not isinstance(v, str) for k, v in criteria.items()):
                    raise ValueError("Expected at least two described option IDs")
            if set(self.criteria(q)) != set(self.criteria(q, "text")):
                raise ValueError("Audio and text option sets differ")
        expected = {"questions": len(self.questions), "clips": len({q["clip_id"] for q in self.questions}),
                    "tasks": len({q["task"] for q in self.questions})}
        if any(self.manifest.get(k) != v for k, v in expected.items()):
            raise ValueError("Manifest counts do not match the question file")

    @staticmethod
    def criteria(q, mode="audio"):
        return q[f"{mode}_request"]["questions"]["action"]["criteria"]

    def verify(self, *, audio=True):
        files = self.manifest.get("files", {})
        required = {"questions.jsonl", "answers.jsonl"} | {q["audio"] for q in self.questions}
        if not required.issubset(files):
            raise ValueError("Manifest omits required file hashes")
        for relative, expected in files.items():
            if not audio and relative.startswith("audio/"):
                continue
            if file_sha(contained_file(self.root, relative)) != expected:
                raise ValueError(f"File integrity check failed: {relative}")
        if audio:
            checked = set()
            for q in self.questions:
                if q["audio"] in checked:
                    continue
                self.audio_path(q)
                checked.add(q["audio"])
        self.references()
        return {"version": self.manifest["version"], "questions": len(self.questions),
                "clips": self.manifest["clips"], "tasks": self.manifest["tasks"], "fingerprint": self.fingerprint}

    def audio_path(self, q):
        path = contained_file(self.root, q["audio"])
        if file_sha(path) != q["audio_sha256"]:
            raise ValueError("Audio hash does not match question")
        with wave.open(str(path), "rb") as w:
            if (w.getnchannels(), w.getframerate(), w.getsampwidth()) != (1, 16000, 2):
                raise ValueError("Expected mono 16 kHz PCM16 WAV")
            if abs(w.getnframes() / w.getframerate() - q["duration_seconds"]) > 0.025:
                raise ValueError("Audio duration does not match question")
        return path

    def references(self):
        refs = {r["id"]: r for r in read_jsonl(contained_file(self.root, "answers.jsonl"))}
        if refs.keys() != self.by_id.keys():
            raise ValueError("Question and reference IDs do not match")
        for key, ref in refs.items():
            options = self.criteria(self.by_id[key])
            accepted = ref.get("accepted_labels", [ref.get("label")])
            if not isinstance(accepted, list) or not accepted or ref.get("label") not in accepted or any(v not in options for v in accepted):
                raise ValueError("Reference answer is not an allowed option")
        return refs

    def model_input(self, q, mode="audio", *, model=None):
        # This is the only object passed to custom predictors. No gold-file reads.
        value = {k: deepcopy(q[k]) for k in ("id", "clip_id", "task", "family", "duration_seconds", "duration_bucket")}
        value["request"] = deepcopy(q[f"{mode}_request"])
        if model:
            value["request"]["model"] = model
        value["modality"] = mode
        if mode == "audio":
            value["audio_path"] = str(self.audio_path(q))
        return value


def download(root, repo=DEFAULT_REPO, revision=DEFAULT_REVISION):
    from huggingface_hub import snapshot_download
    try:
        snapshot_download(repo_id=repo, repo_type="dataset", revision=revision, local_dir=root,
                          allow_patterns=["manifest.json", "questions.jsonl", "answers.jsonl", "audio/*.wav", "README.md", "provenance.json"])
    except Exception as exc:
        raise ValueError(f"Private dataset download failed ({type(exc).__name__}). Check connectivity, request repository access, authenticate with `hf auth login`, and verify the dataset revision.") from None
    return Dataset(root).verify()
