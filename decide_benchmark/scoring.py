"""Strict keyed scoring. Missing/error rows remain in the denominator."""
from __future__ import annotations

from collections import defaultdict
import math


def validate_prediction(value, criteria):
    if isinstance(value, str):
        value = {"choice": value}
    if not isinstance(value, dict) or not isinstance(value.get("choice"), str) or value["choice"] not in criteria:
        raise ValueError("Prediction must choose an allowed option ID")
    result = {"choice": value["choice"]}
    probabilities = value.get("probabilities")
    if probabilities is not None:
        if not isinstance(probabilities, dict) or set(probabilities) != set(criteria):
            raise ValueError("Probability keys must exactly match the option IDs")
        if any(type(v) not in (int, float) or not math.isfinite(v) or not 0 <= v <= 1 for v in probabilities.values()):
            raise ValueError("Probabilities must be finite numbers between zero and one")
        if not math.isclose(sum(probabilities.values()), 1, abs_tol=0.001):
            raise ValueError("Probabilities must sum to one")
        if probabilities[value["choice"]] < max(probabilities.values()) - 1e-6:
            raise ValueError("Choice must have maximal probability")
        result["probabilities"] = probabilities
    return result


def score(dataset, predictions, questions=None):
    questions = dataset.questions if questions is None else questions
    selected = {q["id"]: q for q in questions}
    refs = dataset.references()
    by_id = {}
    for p in predictions:
        key = p.get("id")
        if key not in selected:
            raise ValueError(f"Unknown or unselected prediction ID: {key}")
        if key in by_id:
            raise ValueError(f"Duplicate prediction ID: {key}")
        if "dataset_fingerprint" in p and p["dataset_fingerprint"] != dataset.fingerprint:
            raise ValueError("Prediction was made against a different dataset version")
        by_id[key] = p
    outcomes = []
    for key, q in selected.items():
        p = by_id.get(key)
        valid, choice = False, None
        if p is not None and not p.get("error"):
            answer = validate_prediction(p, dataset.criteria(q))
            valid, choice = True, answer["choice"]
        ref = refs[key]
        outcomes.append({"id": key, "task": q["task"], "family": q["family"], "duration_bucket": q["duration_bucket"],
                         "valid": valid, "exact": valid and choice == ref["label"],
                         "accepted": valid and choice in ref.get("accepted_labels", [ref["label"]]), "choice": choice})

    def aggregate(rows):
        n, valid = len(rows), sum(r["valid"] for r in rows)
        correct = sum(r["exact"] for r in rows)
        accepted = sum(r["accepted"] for r in rows)
        return {"questions": n, "valid_predictions": valid, "missing_or_failed": n - valid,
                "coverage": valid / n if n else None, "correct": correct,
                "accuracy": correct / n if n else None, "accepted_accuracy": accepted / n if n else None,
                "accuracy_on_valid": correct / valid if valid else None}

    grouped = {}
    for dim in ("task", "family", "duration_bucket"):
        groups = defaultdict(list)
        for row in outcomes:
            groups[row[dim]].append(row)
        grouped[dim] = {k: aggregate(v) for k, v in sorted(groups.items())}
    task_scores = [r["accuracy"] for r in grouped["task"].values()]
    return {"dataset": dataset.manifest["name"], "version": dataset.manifest["version"],
            "dataset_fingerprint": dataset.fingerprint, "overall": aggregate(outcomes),
            "task_macro_accuracy": sum(task_scores) / len(task_scores) if task_scores else None,
            "by_task": grouped["task"], "by_family": grouped["family"], "by_duration": grouped["duration_bucket"]}
