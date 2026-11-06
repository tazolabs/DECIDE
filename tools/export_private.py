#!/usr/bin/env python3
"""Maintainer export from the private source checkout; never writes inside this repo.

Only the paper's frozen v1.0 membership and actual recorded prompts are exported.
This script does not query or modify the annotation application.
"""
from __future__ import annotations

import argparse
from collections import Counter
import csv
import hashlib
import json
from pathlib import Path
import shutil


PUBLIC_ROOT = Path(__file__).resolve().parents[1]
PREVIEWS = [
    ("row_9d84f60563ee4e1d874368d3", "Lead qualification", "The agent is checking whether the caller is interested in the programme.", "Is the caller interested in the programme?"),
    ("row_5a6631918a0a100c14c50ef0", "Graph routing", "Current node: opening. The agent is checking whether the caller has time for the conversation.", "What should the agent do immediately after this clip?"),
    ("row_edba3af602c81451a0b5ada2", "Tool selection", "The agent can send programme information after the caller agrees to receive it.", "Which external tool, if any, should the agent select?"),
    ("row_b5d630564f4b96d8eb41a34d", "Next turn", "The agent is wrapping up after learning that the caller has already joined a college. Listen to the caller's response at the end.", "Who should speak or continue speaking immediately after this clip?"),
    ("row_f69253bb5b422993a24e2edb", "Caller emotion", "The agent has thanked the caller and offered help with future questions. Judge only the caller's voice in the clip.", "What emotion or engagement does the caller express?"),
    ("row_6d4fa7a9cf88de7d0eedfe8c", "Language switching", "Listen only to the language used within this clip. A change within one speaker also counts.", "Is there a language switch within this clip?"),
]


def sha(path):
    return hashlib.file_digest(path.open("rb"), "sha256").hexdigest()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")


def write_jsonl(path, rows):
    path.write_text("".join(json.dumps(r, ensure_ascii=False, allow_nan=False) + "\n" for r in rows))


def family(task):
    if task.startswith("graph."):
        return "Graph routing"
    if task.startswith("external_tool."):
        return "Tool decisions"
    if task == "conversation.next_speaker":
        return "Turn taking"
    if task == "acoustic.language_switch":
        return "Language switching"
    if task.startswith("acoustic."):
        return "Voice properties"
    return "Business and conversation"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--write-previews", action="store_true", help="Explicitly publish the six allowlisted examples to site/preview")
    args = parser.parse_args()
    if args.write_previews and (PUBLIC_ROOT / "site/preview/redactions.json").exists():
        parser.error("Public previews have privacy redactions; raw export must not overwrite them")
    root, out = args.source.resolve(), args.output.resolve()
    if out == PUBLIC_ROOT or PUBLIC_ROOT in out.parents:
        parser.error("The full export must be outside the public repository")
    if out.exists() and any(out.iterdir()):
        parser.error("Use a new empty output directory")
    assets = root / "docs/reports/assets/tazo-voice-benchmark-2026-10-24"
    scores = list(csv.DictReader((assets / "retained-row-scores.csv").open()))
    assert len(scores) == 4867 and len({r["row_id"] for r in scores}) == 4867
    metrics = json.loads((assets / "metrics.json").read_text())
    members = {r["row_id"] for r in scores}
    records = {r["snippet_id"]: r for r in map(json.loads, (root / "benchmark/shortlist_2000/snippets.jsonl").open())}
    requests = {}
    for source in metrics["provenance"]:
        ids = {r["row_id"] for r in scores if r["cohort"] == source["cohort"]}
        run = root / source["run"]
        assert sha(run / "requests.jsonl") == source["requests_sha256"]
        for line in (run / "requests.jsonl").open():
            r = json.loads(line)
            if r["row_id"] in ids:
                requests[r["row_id"], source["model"]] = r
    assert len(requests) == len(members) * 2
    out.mkdir(parents=True, exist_ok=True)
    (out / "audio").mkdir()
    examples, answers, previews, preview_answers = [], [], [], []
    copied = set()
    public_specs = {r[0]: (i, r) for i, r in enumerate(PREVIEWS, 1)}
    for r in scores:
        tazo, jev = requests[r["row_id"], "tazo"], requests[r["row_id"], "jev"]
        record = records[r["snippet_id"]]
        assert tazo["audio_sha256"] == jev["audio_sha256"] == record["audio_sha256"]
        audio = "audio/" + record["snippet_id"] + ".wav"
        if audio not in copied:
            original = root / "benchmark/shortlist_2000" / record["audio_file"]
            assert sha(original) == record["audio_sha256"]
            shutil.copyfile(original, out / audio)
            copied.add(audio)
        ar = {k: tazo["request"][k] for k in ("state", "questions")}
        tr = {k: jev["request"][k] for k in ("state", "questions")}
        choices = ar["questions"]["action"]["criteria"]
        assert set(choices) == set(tr["questions"]["action"]["criteria"])
        assert r["gold"] in choices
        example = {
            "id": r["row_id"], "clip_id": r["snippet_id"], "task": r["decision_id"],
            "family": family(r["decision_id"]), "duration_seconds": record["duration_seconds"],
            "duration_bucket": record["duration_bucket"],
            "source_group": hashlib.sha256(record["split_group"].encode()).hexdigest()[:24],
            "audio": audio, "audio_sha256": record["audio_sha256"],
            "audio_request": ar, "text_request": tr, "stt_options": jev["stt_options"],
        }
        examples.append(example)
        answers.append({"id": r["row_id"], "label": r["gold"], "accepted_labels": json.loads(r["accepted_labels"])})
        if r["row_id"] in public_specs:
            number, (_, title, context, question) = public_specs[r["row_id"]]
            public_id = f"example-{number:02d}"
            safe_request = {"state": {"context": context}, "questions": {"action": {
                "type": "choice", "instructions": question,
                "criteria": {k: k.replace("_", " ").capitalize() for k in choices},
            }}}
            transcript = jev["request"]["state"]["clip_transcript"]
            # Only six public clips. No source paths, full-call histories or reviewer notes.
            public_example = {**{k: example[k] for k in ("task", "family", "duration_seconds", "duration_bucket", "audio_sha256")},
                "id": public_id, "clip_id": public_id, "source_group": public_id,
                "audio": f"audio/{public_id}.wav", "title": title,
                "audio_request": safe_request,
                "text_request": {**safe_request, "state": {"context": context,
                    "input_modality": "Use the supplied STT representation. No audio is supplied. Do not invent vocal tone or other unavailable acoustic cues.",
                    "clip_transcript": transcript}}, "stt_options": jev["stt_options"]}
            previews.append(public_example)
            preview_answers.append({"id": public_id, "label": r["gold"], "accepted_labels": [r["gold"]]})
            if args.write_previews:
                dest = PUBLIC_ROOT / "site/preview" / public_example["audio"]
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(out / audio, dest)
    write_jsonl(out / "questions.jsonl", examples)
    write_jsonl(out / "answers.jsonl", answers)
    info = {
        "name": "DECIDE", "version": "1.0", "schema_version": 1,
        "questions": len(examples), "clips": len(copied), "tasks": len({e["task"] for e in examples}),
        "source_calls": len({e["source_group"] for e in examples}),
        "task_counts": dict(sorted(Counter(e["task"] for e in examples).items())),
        "prompt_profile": "frozen published comparison; audio/text requests retain their recorded instructions",
        "files": {p.relative_to(out).as_posix(): sha(p) for p in sorted(out.rglob("*")) if p.is_file()},
    }
    assert (info["clips"], info["tasks"], info["source_calls"]) == (1081, 32, 570)
    write_json(out / "manifest.json", info)
    write_json(out / "provenance.json", {"source_membership_sha256": sha(assets / "retained-row-scores.csv"),
        "source_runs": metrics["provenance"], "cohort_rule": metrics["cohort_rule"],
        "routing_comparison": metrics.get("routing_comparison"), "notes": "Reference labels are frozen from the paper's membership, not a live annotation DB."})
    if args.write_previews:
        assert len(previews) == 6
        p = PUBLIC_ROOT / "site/preview"
        write_jsonl(p / "questions.jsonl", sorted(previews, key=lambda e: e["id"]))
        write_jsonl(p / "answers.jsonl", sorted(preview_answers, key=lambda e: e["id"]))
        write_json(p / "manifest.json", {"name": "DECIDE preview", "version": "1.0-preview", "schema_version": 1,
            "questions": 6, "clips": 6, "tasks": 6, "source_calls": 6,
            "files": {f.relative_to(p).as_posix(): sha(f) for f in sorted(p.rglob("*")) if f.is_file() and f.name != "manifest.json"}})
    print(json.dumps({k: v for k, v in info.items() if k != "files"}, indent=2))


if __name__ == "__main__":
    main()
