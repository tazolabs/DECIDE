"""Download, verify, run and score DECIDE without the private annotation app."""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from copy import deepcopy
import importlib
import json
import os
from pathlib import Path
import sys

from .data import DEFAULT_REPO, DEFAULT_REVISION, ROOT, Dataset, digest, download, read_jsonl
from .scoring import score, validate_prediction


def save_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + "\n")


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="command", required=True)
    d = sub.add_parser("download", help="Download the private benchmark after access is granted")
    d.add_argument("--repo", default=DEFAULT_REPO)
    d.add_argument("--revision", default=DEFAULT_REVISION)
    d.add_argument("--output", type=Path, default=ROOT / "data/decide-v1")
    d.add_argument("--env-file", type=Path, default=ROOT / ".env")
    for command in ("validate", "run", "score"):
        cmd = sub.add_parser(command)
        cmd.add_argument("--data", type=Path, help="Local private export or site/preview")
        cmd.add_argument("--preview", action="store_true", help="Use only the six public demonstration questions")
        if command in ("run", "score"):
            cmd.add_argument("--task", action="append", help="Exact task ID; repeat for multiple tasks")
            cmd.add_argument("--limit", type=int)
        if command == "score":
            cmd.add_argument("--predictions", type=Path, required=True)
            cmd.add_argument("--output", type=Path, default=ROOT / "runs/score.json")
        if command == "run":
            model_group = cmd.add_mutually_exclusive_group(required=True)
            model_group.add_argument("--provider", choices=("tazo", "jev"))
            model_group.add_argument("--predictor", help="Custom Python callable, e.g. examples.custom_model:predict")
            cmd.add_argument("--modality", choices=("audio", "text"), default=None)
            cmd.add_argument("--model", help="Default: tazo-large or jev-1.13.0")
            cmd.add_argument("--output", type=Path, default=ROOT / "runs/latest")
            cmd.add_argument("--concurrency", type=int, default=2)
            cmd.add_argument("--requests-per-second", type=float, default=1)
            cmd.add_argument("--max-attempts", type=int, default=4)
            cmd.add_argument("--env-file", type=Path, default=ROOT / ".env")
    return p


def selection(args, dataset):
    if args.limit is not None and args.limit < 1:
        raise ValueError("--limit must be positive")
    if args.task and set(args.task) - {q["task"] for q in dataset.questions}:
        raise ValueError("Unknown task ID; inspect manifest.json for available tasks")
    questions = [q for q in dataset.questions if not args.task or q["task"] in args.task]
    if args.limit is not None:
        questions = questions[:args.limit]
    if not questions:
        raise ValueError("No questions selected")
    return questions


def token(name):
    value = os.environ.get(name, "").strip()
    if value.lower().startswith("bearer "):
        value = value[7:].strip()
    if not value or any(c.isspace() for c in value):
        raise ValueError(f"Set {name} in the environment or .env")
    return value


def run(args, dataset, questions):
    if args.concurrency < 1:
        raise ValueError("--concurrency must be positive")
    try:
        from dotenv import load_dotenv
        load_dotenv(args.env_file, override=False)
    except ImportError:
        pass
    mode = args.modality or ("text" if args.provider == "jev" else "audio")
    client, callback = None, None
    if args.predictor:
        module, function = args.predictor.split(":", 1)
        callback = getattr(importlib.import_module(module), function)
        if not callable(callback):
            raise ValueError("Predictor must be callable")
        model = args.model or args.predictor
    else:
        from .tazo_client import TazoClient
        from .jev_client import JevClient
        if mode != ("audio" if args.provider == "tazo" else "text"):
            raise ValueError("Tazo adapter uses audio; Jev adapter uses text")
        model = args.model or ("tazo-large" if args.provider == "tazo" else "jev-1.13.0")
        cls, url, key = (TazoClient, "https://api.tazolabs.com/v1/decisions", "TAZO_BEARER_TOKEN") if args.provider == "tazo" else (JevClient, "https://api.typesafe.ai/v1/systemone", "JEV_API_KEY")
        client = cls(url, token(key), requests_per_second=args.requests_per_second, max_attempts=args.max_attempts)

    args.output.mkdir(parents=True, exist_ok=True)
    plan = {"dataset_fingerprint": dataset.fingerprint, "version": dataset.manifest["version"], "model": model,
            "provider": args.provider or args.predictor, "modality": mode, "question_ids": [q["id"] for q in questions],
            "requests_sha256": digest([q[f"{mode}_request"] for q in questions])}
    plan_file = args.output / "run.json"
    if plan_file.exists() and json.loads(plan_file.read_text()) != plan:
        raise ValueError("Output directory belongs to another run; use a new --output")
    save_json(plan_file, plan)
    result_file = args.output / "predictions.jsonl"
    prior = read_jsonl(result_file) if result_file.exists() else []
    allowed = {q["id"] for q in questions}
    if any(p["id"] not in allowed or p.get("dataset_fingerprint") != dataset.fingerprint for p in prior):
        raise ValueError("Saved predictions do not match this run")
    completed = {p["id"]: p for p in prior if not p.get("error")}
    # Rewrite cleanly before appending so failed rows can be retried without duplicate IDs.
    result_file.write_text("".join(json.dumps(p, ensure_ascii=False) + "\n" for p in completed.values()))
    pending = [q for q in questions if q["id"] not in completed]

    def predict(q):
        base = {"id": q["id"], "model": model, "dataset_fingerprint": dataset.fingerprint}
        try:
            item = dataset.model_input(q, mode, model=model)
            if callback:
                answer = callback(deepcopy(item))
            else:
                answer = client.predict(item["request"], Path(item["audio_path"]) if mode == "audio" else None)
                if not answer["ok"]:
                    return {**base, "error": answer["error"], "fatal": answer.get("fatal", False)}
            return {**base, **validate_prediction(answer, dataset.criteria(q, mode))}
        except Exception as exc:
            # No exception message/body serialization: models can echo secrets or input text.
            return {**base, "error": f"Prediction failed ({type(exc).__name__})"}

    print(json.dumps({"questions": len(questions), "clips": len({q["clip_id"] for q in questions}),
                      "cached": len(completed), "pending": len(pending), "model": model, "modality": mode}), flush=True)
    with result_file.open("a", encoding="utf-8") as output, ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        # Submit only concurrency-sized groups, so fatal auth failures stop new work.
        for start in range(0, len(pending), args.concurrency):
            futures = [pool.submit(predict, q) for q in pending[start:start + args.concurrency]]
            fatal = False
            for future in as_completed(futures):
                result = future.result()
                completed[result["id"]] = result
                output.write(json.dumps(result, ensure_ascii=False, allow_nan=False) + "\n")
                output.flush()
                print(f"[{len(completed)}/{len(questions)}] {result['id']}: {result.get('choice', result.get('error'))}", flush=True)
                fatal = fatal or result.get("fatal", False)
            if fatal:
                print("Stopped after a fatal provider error. Correct credentials/configuration and rerun to resume.", file=sys.stderr)
                break
    report = score(dataset, list(completed.values()), questions)
    report.update(model=model, modality=mode)
    save_json(args.output / "report.json", report)
    return report


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        if args.command == "download":
            try:
                from dotenv import load_dotenv
                load_dotenv(args.env_file, override=False)
            except ImportError:
                pass
            result = download(args.output, args.repo, args.revision)
        else:
            if args.data and args.preview:
                raise ValueError("Choose --data or --preview")
            dataset = Dataset(ROOT / "site/preview" if args.preview else args.data or ROOT / "data/decide-v1")
            # Always verify input/reference hashes before inference or scoring.
            dataset.verify(audio=args.command != "score")
            if args.command == "validate":
                result = {"status": "valid", "questions": len(dataset.questions), "version": dataset.manifest["version"]}
            elif args.command == "score":
                result = score(dataset, read_jsonl(args.predictions), selection(args, dataset))
                save_json(args.output, result)
            else:
                result = run(args, dataset, selection(args, dataset))
        print(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False))
        return 0
    except (ValueError, KeyError, OSError, ImportError) as exc:
        print(f"DECIDE error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
