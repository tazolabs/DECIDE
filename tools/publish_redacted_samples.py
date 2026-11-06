#!/usr/bin/env python3
"""Rebuild only the public HF sample from reviewed, already-redacted website audio.

Operator dependencies: huggingface_hub and pyarrow. Private text replacements
are supplied separately and must never be committed to this public repository.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
REPO_ID = "tazolabs/DECIDE-samples"
PRIVATE_REPO_ID = "tazolabs/DECIDE"
PARQUET = "data/preview-00000-of-00001.parquet"
FILES = ["README.md", "manifest.json", "redactions.json", PARQUET]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def scrub(value, replacements):
    if isinstance(value, str):
        for pattern, replacement in replacements.items():
            value = re.sub(pattern, replacement, value, flags=re.I)
        return value
    if isinstance(value, list):
        return [scrub(item, replacements) for item in value]
    if isinstance(value, dict):
        return {key: scrub(item, replacements) for key, item in value.items()}
    return value


def build(output, replacements):
    import pyarrow as pa
    import pyarrow.parquet as pq
    from huggingface_hub import HfApi, hf_hub_download

    preview = ROOT / "site/preview"
    plan = json.loads((preview / "redactions.json").read_text())
    clips = {clip["id"]: clip for clip in plan["clips"]}
    info = HfApi(token=False).dataset_info(REPO_ID)
    if info.private:
        raise ValueError("Expected the existing public sample repository")

    def download(name):
        return Path(hf_hub_download(REPO_ID, name, repo_type="dataset", revision=info.sha, token=False))

    table = pq.read_table(download(PARQUET))
    rows = table.to_pylist()
    if len(rows) != 20 or {row["clip_id"] for row in rows} != set(clips):
        raise ValueError("Expected twenty questions sharing exactly the six reviewed clips")
    for row in rows:
        clip = clips[row["clip_id"]]
        if sha(row["audio"]["bytes"]) not in {clip["source_audio_sha256"], clip["audio_sha256"]}:
            raise ValueError("Remote audio differs from the reviewed source/replacement")
        data = (preview / "audio" / f"{clip['id']}.wav").read_bytes()
        if sha(data) != clip["audio_sha256"]:
            raise ValueError("Redacted website audio hash differs from its plan")
        row["audio"] = {"bytes": data, "path": f"{clip['id']}.wav"}
        # Scrub text only; never apply substitutions to encoded audio bytes.
        for key in set(row) - {"audio"}:
            row[key] = scrub(row[key], replacements)
        if clip["spans"] and plan["notice"] not in row["context"]:
            row["context"] += " " + plan["notice"]
        if row["answer"] not in {item["id"] for item in row["options"]}:
            raise ValueError("Reference label is not an option")

    output.mkdir(parents=True, exist_ok=True)
    target = output / PARQUET
    target.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(pa.Table.from_pylist(rows, schema=table.schema), target, compression="snappy")
    restored = pq.read_table(target).to_pylist()
    assert len(restored) == 20
    for row in restored:
        assert sha(row["audio"]["bytes"]) == clips[row["clip_id"]]["audio_sha256"]

    manifest = json.loads(download("manifest.json").read_text())
    manifest.update({"version": "1.0-samples-redacted-1", "parquet_sha256": sha(target.read_bytes()),
                     "audio_redaction": "redactions.json",
                     "clips": [{"id": key, "audio_sha256": clip["audio_sha256"]} for key, clip in clips.items()]})
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    (output / "redactions.json").write_text(json.dumps(plan, indent=2) + "\n")
    card = download("README.md").read_text()
    card = re.sub(r"(?ms)^Authors:.*?(?=^Paper/arXiv link:)", "", card)
    card = scrub(card, replacements)
    heading = "## Privacy redaction"
    if heading in card:
        card = card[:card.index(heading)].rstrip() + "\n"
    card += ("\n" + heading + "\n\nClient organization names in four of the six clips are replaced "
             "with privacy beeps. These edits replace the speech rather than overlaying it; durations "
             "and sample rates are unchanged. The other two clips have no detected identifier spans. "
             "The 20 rows reuse these six edited recordings, with original decision labels retained. "
             "Ignore synthetic privacy beeps when assessing original disturbance or speaker count. "
             "Timestamp ranges are in `redactions.json`. This release replaces the current files; "
             "earlier repository revisions and downloaded copies require separate removal.\n")
    (output / "README.md").write_text(card)
    return info.sha


def publish(output, parent_commit):
    from huggingface_hub import CommitOperationAdd, HfApi, hf_hub_download

    api = HfApi()
    before = api.dataset_info(PRIVATE_REPO_ID)
    if not before.private:
        raise ValueError("The full benchmark must remain private")
    commit = api.create_commit(REPO_ID, repo_type="dataset", parent_commit=parent_commit,
        commit_message="Replace public sample identifiers with privacy beeps",
        operations=[CommitOperationAdd(path_in_repo=name, path_or_fileobj=str(output / name)) for name in FILES])
    for name in FILES:
        remote = hf_hub_download(REPO_ID, name, repo_type="dataset", revision=commit.oid,
                                 token=False, force_download=True)
        if sha(Path(remote).read_bytes()) != sha((output / name).read_bytes()):
            raise ValueError("Published file differs from the verified local release")
    after = api.dataset_info(PRIVATE_REPO_ID)
    if not after.private or before.sha != after.sha:
        raise ValueError("Private benchmark changed during public-sample update")
    return commit.oid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--text-replacements", type=Path, required=True,
                        help="Private JSON mapping of reviewed regex patterns to redaction placeholders")
    parser.add_argument("--publish", action="store_true")
    args = parser.parse_args()
    output = args.output.resolve()
    if output == ROOT or ROOT in output.parents:
        parser.error("Staging directory must be outside the public checkout")
    replacements = json.loads(args.text_replacements.read_text())
    parent = build(output, replacements)
    result = {"questions": 20, "unique_clips": 6, "source_commit": parent, "output": str(output)}
    if args.publish:
        result["published_commit"] = publish(output, parent)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
