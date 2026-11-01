"""Checks for denominator integrity, label isolation, private paths and response parsing."""
from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

from decide_benchmark.data import Dataset, ROOT, contained_file
from decide_benchmark.scoring import score, validate_prediction
from decide_benchmark.tazo_client import validate_response, ModelMismatchError
from decide_benchmark.jev_client import validate_jev_response


class EvaluationTests(unittest.TestCase):
    def setUp(self):
        self.data = Dataset(ROOT / "site/preview")

    def test_preview_audio_and_manifest(self):
        report = self.data.verify()
        self.assertEqual((report["questions"], report["clips"]), (6, 6))

    def test_missing_rows_count_in_denominator(self):
        ref = self.data.references()["example-01"]
        report = score(self.data, [{"id": "example-01", "choice": ref["label"]}])
        self.assertEqual(report["overall"]["correct"], 1)
        self.assertEqual(report["overall"]["missing_or_failed"], 5)
        self.assertAlmostEqual(report["overall"]["accuracy"], 1 / 6)
        self.assertEqual(report["overall"]["accuracy_on_valid"], 1)

    def test_explicit_failure_is_incorrect(self):
        report = score(self.data, [{"id": "example-01", "error": "timeout"}])
        self.assertEqual(report["overall"]["accuracy"], 0)
        self.assertEqual(report["overall"]["coverage"], 0)

    def test_reference_predictions_score_perfectly(self):
        preds = [{"id": k, "choice": r["label"]} for k, r in self.data.references().items()]
        report = score(self.data, preds)
        self.assertEqual(report["overall"]["accuracy"], 1)
        self.assertEqual(report["task_macro_accuracy"], 1)

    def test_unknown_duplicate_and_stale_predictions_rejected(self):
        for preds in ([{"id": "unknown", "choice": "caller"}],
                      [{"id": "example-04", "choice": "caller"}] * 2,
                      [{"id": "example-04", "choice": "caller", "dataset_fingerprint": "wrong"}]):
            with self.assertRaises(ValueError):
                score(self.data, preds)

    def test_invalid_choice_is_not_silently_ignored(self):
        with self.assertRaises(ValueError):
            score(self.data, [{"id": "example-04", "choice": "not_an_option"}])

    def test_probability_validation(self):
        criteria = {"agent": "Agent", "caller": "Caller"}
        for p in ({"choice": "agent", "probabilities": {"agent": .4, "caller": .6}},
                  {"choice": "agent", "probabilities": {"agent": float("nan"), "caller": 1}},
                  {"choice": "agent", "probabilities": {"agent": .9, "extra": .1}},
                  {"choice": "agent", "probabilities": {"agent": .9, "caller": .9}}):
            with self.assertRaises(ValueError):
                validate_prediction(p, criteria)

    def test_predictor_input_has_no_gold_and_is_independent(self):
        question = self.data.questions[0]
        item = self.data.model_input(question, "audio", model="custom")
        self.assertNotIn("label", item)
        self.assertNotIn("answers", item)
        self.assertEqual(set(item), {"id", "clip_id", "task", "family", "duration_seconds", "duration_bucket", "request", "modality", "audio_path"})
        before = deepcopy(question)
        item["request"]["state"]["context"] = "changed"
        self.assertEqual(question, before)

    def test_text_predictor_receives_no_audio_path(self):
        item = self.data.model_input(self.data.questions[0], "text")
        self.assertNotIn("audio_path", item)
        self.assertIn("clip_transcript", item["request"]["state"])

    def test_path_traversal_and_absolute_paths_rejected(self):
        for value in ("../README.md", str(ROOT / "README.md")):
            with self.assertRaises(ValueError):
                contained_file(self.data.root, value)

    def test_tampered_question_file_rejected(self):
        import shutil
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name in ("manifest.json", "questions.jsonl", "answers.jsonl"):
                shutil.copyfile(self.data.root / name, root / name)
            q = json.loads((root / "questions.jsonl").read_text().splitlines()[0])
            q["audio_request"]["state"]["context"] = "modified"
            lines = (root / "questions.jsonl").read_text().splitlines()
            lines[0] = json.dumps(q)
            (root / "questions.jsonl").write_text("\n".join(lines) + "\n")
            with self.assertRaisesRegex(ValueError, "integrity"):
                Dataset(root).verify(audio=False)

    def test_native_api_contract_and_model_check(self):
        request = {"model": "tazo-large", "questions": {"action": {"criteria": {"a": "A", "b": "B"}}}}
        response = {"model": "tazo-large", "answers": {"action": {"type": "choice", "choice": "a",
                    "probabilities": {"a": .8, "b": .2}, "confidence": .8}}, "elapsed_ms": 200}
        self.assertEqual(validate_response(response, request)["choice"], "a")
        with self.assertRaises(ModelMismatchError):
            validate_response({**response, "model": "other"}, request)
        response["model"] = request["model"] = "jev-1.13.0"
        self.assertEqual(validate_jev_response(response, request)["choice"], "a")

    def test_runner_resumes_without_duplicate_calls(self):
        from decide_benchmark.cli import main
        calls = []

        def predict(example):
            calls.append(example["id"])
            self.assertNotIn("label", example)
            return next(iter(example["request"]["questions"]["action"]["criteria"]))

        with tempfile.TemporaryDirectory() as tmp, patch("decide_benchmark.cli.importlib.import_module", return_value=SimpleNamespace(predict=predict)):
            args = ["run", "--preview", "--predictor", "local:predict", "--output", tmp, "--concurrency", "1"]
            self.assertEqual(main(args), 0)
            self.assertEqual(len(calls), 6)
            self.assertEqual(main(args), 0)
            self.assertEqual(len(calls), 6)
            predictions = [json.loads(line) for line in (Path(tmp) / "predictions.jsonl").read_text().splitlines()]
            self.assertEqual(len(predictions), 6)
            self.assertEqual(len({p["id"] for p in predictions}), 6)
            self.assertEqual(main(args + ["--limit", "2"]), 1)

    def test_native_transports_send_multipart_audio_and_json_text(self):
        from decide_benchmark.tazo_client import TazoClient
        from decide_benchmark.jev_client import JevClient
        captured = []

        def post(url, **kwargs):
            captured.append((url, kwargs))
            return None

        session = SimpleNamespace(post=post)
        tazo = TazoClient("https://api.tazolabs.com/v1/decisions", "test-only", session_factory=lambda: session)
        audio = self.data.audio_path(self.data.questions[0])
        request = {"model": "tazo-large", **self.data.questions[0]["audio_request"]}
        tazo.post(session, request, audio)
        self.assertEqual(json.loads(captured[-1][1]["data"]["request"]), request)
        self.assertEqual(captured[-1][1]["files"]["audio"][2], "audio/wav")
        jev = JevClient("https://api.typesafe.ai/v1/systemone", "test-only", session_factory=lambda: session)
        text_request = {"model": "jev-1.13.0", **self.data.questions[0]["text_request"]}
        jev.post(session, text_request, None)
        self.assertEqual(json.loads(captured[-1][1]["data"]), text_request)
        self.assertNotIn("files", captured[-1][1])


if __name__ == "__main__":
    unittest.main()
