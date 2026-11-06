#!/usr/bin/env python3
"""Build exactly 20 privacy-reviewed HF samples; publish only with --publish.

Optional operator dependencies: pyarrow and huggingface_hub.
The source dataset, private review plan and staging output must stay outside this
public checkout. Original audio, identifiers and review transcripts are never uploaded.
"""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import io
import json
from pathlib import Path
import re
import wave

from redact_public_audio import redact_wav

ROOT = Path(__file__).resolve().parents[1]
REPO = "tazolabs/DECIDE-samples"
PRIVATE_REPO = "tazolabs/DECIDE"
PARQUET = "data/preview-00000-of-00001.parquet"
FILES = {"README.md", "manifest.json", "redactions.json", PARQUET}
NOTICE = ("Identifying information is replaced with privacy beeps. Ignore these "
          "synthetic beeps when judging original call disturbance or speaker count.")


def sha(data):
    return hashlib.sha256(data).hexdigest()


def outside_checkout(path):
    path = Path(path).resolve()
    if path == ROOT or ROOT in path.parents:
        raise ValueError("Private inputs and staging output must be outside the public checkout")
    return path


def validate_plan(plan):
    rows = plan["rows"]
    if len(rows) != 20:
        raise ValueError("Exactly twenty reviewed rows are required")
    for key in ("id", "clip_id", "source_row_id"):
        if len({r[key] for r in rows}) != 20:
            raise ValueError(f"Expected twenty distinct {key} values")
    for row in rows:
        for key in ("source_audio_sha256", "reviewed_audio_sha256"):
            if not re.fullmatch(r"[0-9a-f]{64}", row.get(key, "")):
                raise ValueError("Source and reviewed output hashes are required")
        for key in ("id", "clip_id"):
            if not re.fullmatch(r"[a-zA-Z0-9-]+", row[key]):
                raise ValueError("Public identifiers must be opaque filename-safe aliases")
        required = ("independent_transcripts_checked", "identified_entities_reviewed",
                    "redacted_retranscription_checked")
        if not all(row.get("review", {}).get(key) is True for key in required):
            raise ValueError("Every sample needs completed source and redacted-audio reviews")
        for span in row["spans"]:
            if span["category"] not in {"person", "client_organization", "organization_url",
                                         "phone", "email", "address", "location", "identifier"}:
                raise ValueError("Unknown redaction category")


def scrub(text, replacements):
    for pattern, replacement in replacements.items():
        text = re.sub(pattern, replacement, text, flags=re.I)
    return text


def validate_public_text(row):
    text = json.dumps({k: v for k, v in row.items() if k != "audio"})
    pattern = (r"row_[0-9a-f]|snippet_|agent_\d|graph_[0-9a-f]|/(?:Users|Volumes)/|"
               r"hf_[A-Za-z0-9]{20,}|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\b\d{10}\b")
    if re.search(pattern, text):
        raise ValueError("Private identifier or contact pattern in public text")


def build(plan_path, source_data, output):
    import pyarrow as pa
    import pyarrow.parquet as pq
    from huggingface_hub import HfApi, hf_hub_download

    plan_path, source_data, output = map(outside_checkout, (plan_path, source_data, output))
    plan = json.loads(plan_path.read_text())
    validate_plan(plan)
    source_manifest = json.loads((source_data / "manifest.json").read_text())
    for name in ("questions.jsonl", "answers.jsonl"):
        if sha((source_data / name).read_bytes()) != source_manifest["files"][name]:
            raise ValueError("Frozen question or reference-label file changed")
    info = HfApi(token=False).dataset_info(REPO)
    if info.private:
        raise ValueError("Expected the existing public sample repository")
    template = hf_hub_download(REPO, PARQUET, repo_type="dataset", revision=info.sha, token=False)
    schema = pq.read_schema(template)
    # Retain the existing HF Audio feature and encoded-WAV schema. No decoder,
    # resampler or audio encoder is needed to add a string metadata column.
    if "scenario" not in schema.names:
        metadata = dict(schema.metadata or {})
        hf_metadata = json.loads(metadata[b"huggingface"])
        hf_metadata["info"]["features"]["scenario"] = {"dtype": "string", "_type": "Value"}
        metadata[b"huggingface"] = json.dumps(hf_metadata).encode()
        schema = schema.append(pa.field("scenario", pa.string())).with_metadata(metadata)
    if output.exists() and any(output.iterdir()):
        raise ValueError("Use an empty staging directory")
    ids = {r["source_row_id"] for r in plan["rows"]}
    questions = {q["id"]: q for q in map(json.loads, (source_data / "questions.jsonl").open())
                 if q["id"] in ids}
    answers = {a["id"]: a for a in map(json.loads, (source_data / "answers.jsonl").open())
               if a["id"] in ids}
    if set(questions) != ids or set(answers) != ids:
        raise ValueError("A selected row is missing from the frozen source")
    rows, clips = [], []
    for selected in plan["rows"]:
        q = questions[selected["source_row_id"]]
        audio_path = (source_data / q["audio"]).resolve()
        if source_data not in audio_path.parents:
            raise ValueError("Audio path escapes the source dataset")
        original = audio_path.read_bytes()
        if sha(original) != q["audio_sha256"] or sha(original) != selected["source_audio_sha256"]:
            raise ValueError("Source audio no longer matches the reviewed recording")
        data = redact_wav(original, selected["spans"], **plan["tone"])
        if sha(data) != selected["reviewed_audio_sha256"]:
            raise ValueError("Output differs from the post-redaction reviewed audio")
        with wave.open(io.BytesIO(data)) as wav:
            duration = wav.getnframes() / wav.getframerate()
        if abs(duration - q["duration_seconds"]) > .011:
            raise ValueError("Audio duration changed")
        criteria = q["audio_request"]["questions"]["action"]["criteria"]
        label = answers[q["id"]]["label"]
        if label not in criteria:
            raise ValueError("Frozen reference label is not an allowed option")
        context = scrub(selected["context"], plan["text_replacements"])
        if selected["spans"]:
            context += " " + NOTICE
        row = {"id": selected["id"], "clip_id": selected["clip_id"],
               "audio": {"bytes": data, "path": selected["clip_id"] + ".wav"},
               "task": q["task"], "family": q["family"], "scenario": selected["scenario"],
               "question": selected["question"], "context": context,
               "options": [{"id": k, "description": scrub(v, plan["text_replacements"])}
                           for k, v in criteria.items()],
               "answer": label, "current_node": selected["current_node"],
               "duration_seconds": duration, "duration_bucket": q["duration_bucket"]}
        validate_public_text(row)
        rows.append(row)
        clips.append({"id": selected["clip_id"], "audio_sha256": sha(data),
                      "duration_seconds": duration, "spans": selected["spans"]})
    if len({sha(r["audio"]["bytes"]) for r in rows}) != 20:
        raise ValueError("The refreshed sample must contain twenty distinct recordings")
    if len({r["family"] for r in rows}) != 6:
        raise ValueError("All six decision families must be represented")
    if set(schema.names) != set(rows[0]):
        raise ValueError("Unexpected public sample schema")
    output.mkdir(parents=True, exist_ok=True)
    target = output / PARQUET
    target.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(pa.Table.from_pylist(rows, schema=schema), target, compression="snappy")
    restored = pq.read_table(target).to_pylist()
    if restored != rows:
        raise ValueError("Parquet round-trip changed sample data")
    manifest = {"name": "DECIDE public samples", "version": plan["version"], "questions": 20,
        "unique_clips": 20, "clips_with_redactions": sum(bool(c["spans"]) for c in clips),
        "tasks": len({r["task"] for r in rows}),
        "families": dict(sorted(Counter(r["family"] for r in rows).items())),
        "scenarios": dict(sorted(Counter(r["scenario"] for r in rows).items())),
        "duration_buckets": dict(sorted(Counter(r["duration_bucket"] for r in rows).items())),
        "audio": {"sample_rate_hz": 16000, "channels": 1, "format": "PCM16 WAV"},
        "source": "Selected production agent–human call excerpts; frozen v1.0 reference labels.",
        "prompt_profile": "Shortened, de-identified demonstration context; not full evaluation prompts.",
        "parquet_sha256": sha(target.read_bytes()), "audio_redaction": "redactions.json",
        "clips": [{k: c[k] for k in ("id", "audio_sha256")} for c in clips]}
    for name, value in [("manifest.json", manifest), ("redactions.json", {
        "version": plan["version"], "method": "replace_pcm_samples", "tone": plan["tone"],
        "notice": NOTICE, "review_method": "Two independent source transcriptions, entity review, "
        "padded timestamp boundaries and independent post-redaction transcription checks.", "clips": clips})]:
        (output / name).write_text(json.dumps(value, indent=2) + "\n")
    (output / "README.md").write_text(dataset_card(manifest))
    return manifest, info.sha


def dataset_card(manifest):
    table = "\n".join(f"| {k} | {v} |" for k, v in manifest["families"].items())
    scenarios = "\n".join(f"| {k} | {v} |" for k, v in manifest["scenarios"].items())
    buckets = "\n".join(f"| {k} | {v} |" for k, v in manifest["duration_buckets"].items())
    return f'''---
language: [en, hi]
pretty_name: DECIDE — 20 Public Samples
task_categories: [audio-classification, question-answering]
size_categories: [n<1K]
tags: [audio, speech, voice-agents, decision-making, multiple-choice, benchmark-preview]
configs:
- config_name: default
  data_files:
  - split: preview
    path: {PARQUET}
---
# DECIDE: 20 public samples

**Decision Evaluation in Calls: Intent, Dialogue and Emotion**

DECIDE is a joint benchmark from [Tazo Labs](https://tazolabs.com/) and
[Bolna](https://www.bolna.ai/), developed through a partnership between both teams.

[Website](https://benchmark.tazolabs.com/) · [GitHub](https://github.com/tazolabs/DECIDE) · [Full benchmark evaluation](https://benchmark.tazolabs.com/evaluate)

This refreshed preview contains **20 labelled questions over 20 distinct audio
clips**, covering **{manifest['tasks']} task types across all six decision families**.
The clips are excerpts from real production conversations between agents and
callers. They span all five duration bands from 3–5 to 20–25 seconds.

## Decision coverage

| Decision family | Rows |
| --- | ---: |
{table}
| **Total** | **20** |

Examples include callback requests, lead qualification, price concerns, information
requests, entrance-exam status, contact roles, routing, tool choice and readiness,
unfinished caller turns, call closure, emotion, disturbance and language switching.

## Call scenarios

| Scenario | Clips |
| --- | ---: |
{scenarios}

| Duration band | Clips |
| --- | ---: |
{buckets}

## Contents and use

Each row includes `audio` (embedded mono 16 kHz PCM16 WAV), `question`, permitted
`context`, allowed `options`, the human reference `answer`, `task`, `family`,
`scenario`, `current_node` when relevant, and duration fields. Public `id` and
`clip_id` values are opaque aliases. No verbatim transcript column, source IDs,
full-call histories, reviewer notes or model predictions are included.

```python
from datasets import Audio, load_dataset

samples = load_dataset("{REPO}", split="preview")
assert len(samples) == 20
samples = samples.cast_column("audio", Audio(decode=False))
row = samples[0]
print(row["question"], row["options"], row["answer"])
wav_bytes = row["audio"]["bytes"]
```

Choose one allowed decision at the **end of the clip**, using only the audio and
permitted context. `agent` is the AI assistant; `caller` is the human/user. Graphs
and tools are reconstructed benchmark specifications, not execution logs. Selecting
a tool does not execute it. Human reference labels are unchanged from frozen v1.0.

## Privacy masking

For legal and privacy reasons, identified personal names, client/institution
names and identifying URLs are replaced with privacy beeps. Public text is also
de-identified. Beeps **replace** the underlying speech, including their fade
boundaries; audio outside the reviewed intervals and clip durations are unchanged.
{manifest['unique_clips'] - manifest['clips_with_redactions']} clips had no detected identifier spans. See `redactions.json` for the edited
intervals. Ignore artificial privacy beeps when judging original call disturbance
or speaker count. Automated checks do not certify exhaustive anonymization.

## Interpretation and access

This is a deliberately varied demonstration, **not a representative test split or
a training set**. Its scores must not be reported as full-benchmark scores. It
replaces the earlier six-clip preview; the website's six integration examples
remain a separate set. Sample version: `{manifest['version']}`.

The full DECIDE v1.0 benchmark contains 4,867 questions over 1,081 clips and 32 tasks
and remains private. Use the hosted evaluator for full-benchmark results.
The code repository's software license does not grant a license to the recordings;
no separate open-data or training license is granted by this sample release.
Paper/arXiv link: forthcoming.
'''


def publish(output, parent):
    from huggingface_hub import HfApi, CommitOperationAdd, hf_hub_download

    output = outside_checkout(output)
    if {p.relative_to(output).as_posix() for p in output.rglob("*") if p.is_file()} != FILES:
        raise ValueError("Staging contains unapproved files")
    api = HfApi()
    before = api.dataset_info(PRIVATE_REPO)
    if not before.private:
        raise ValueError("The full benchmark must remain private")
    commit = api.create_commit(REPO, repo_type="dataset", parent_commit=parent,
        commit_message="Refresh 20 public samples with varied privacy-masked recordings",
        operations=[CommitOperationAdd(path_in_repo=f, path_or_fileobj=str(output / f))
                    for f in sorted(FILES)])
    for name in FILES:
        actual = hf_hub_download(REPO, name, repo_type="dataset", revision=commit.oid,
                                token=False, force_download=True)
        if sha(Path(actual).read_bytes()) != sha((output / name).read_bytes()):
            raise ValueError("Anonymous public download differs from the reviewed release")
    after = api.dataset_info(PRIVATE_REPO)
    if not after.private or after.sha != before.sha:
        raise ValueError("Private benchmark changed during publication")
    return commit.oid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--review-plan", type=Path, required=True)
    parser.add_argument("--source-data", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--publish", action="store_true")
    args = parser.parse_args()
    manifest, parent = build(args.review_plan, args.source_data, args.output)
    result = {k: manifest[k] for k in ("version", "questions", "unique_clips", "tasks",
                                      "families", "scenarios", "duration_buckets")}
    if args.publish:
        result["published_commit"] = publish(args.output, parent)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
