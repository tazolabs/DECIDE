# Dataset format (for benchmark operators)

This documents the internal storage format, not a participant download workflow.
Full data access is restricted to benchmark operators and controlled workers.
The public integration format can be explored using the six preview examples.

Private dataset repository: `tazolabs/DECIDE`, type `dataset`, tag `v1.0`.

```text
manifest.json
questions.jsonl
answers.jsonl
audio/*.wav
provenance.json
README.md
```

`manifest.json` has `schema_version: 1`, the dataset name/version, question/clip/task
counts, task counts, and a `files` mapping from relative paths to SHA-256 digests.
An evaluator validates those digests and rejects paths outside the data directory.
Audio files are mono, 16 kHz, PCM16 WAV. Several questions can share one audio file.

## A question input

Illustrative schema; the six actual public examples are under `site/preview/`.

```json
{
  "id": "unique_question_id",
  "clip_id": "unique_clip_id",
  "task": "conversation.next_speaker",
  "family": "Turn taking",
  "duration_seconds": 7.3,
  "duration_bucket": "05-10s",
  "source_group": "opaque_source_call_group",
  "audio": "audio/unique_clip_id.wav",
  "audio_sha256": "sha256_of_exact_wav_bytes",
  "audio_request": {
    "state": {"context": "Permitted history and task context"},
    "questions": {"action": {
      "type": "choice",
      "instructions": "Who should speak next?",
      "criteria": {
        "agent": "The agent should speak or continue.",
        "caller": "The caller should speak or continue.",
        "end_call": "The conversation has ended.",
        "insufficient_evidence": "No usable basis for a decision."
      }
    }}
  },
  "text_request": {
    "state": {
      "context": "Permitted history and task context",
      "input_modality": "No audio supplied; apply the text representation.",
      "clip_transcript": {"text": "STT text", "language_code": "en-IN", "segments": []}
    },
    "questions": {"action": {"type": "choice", "instructions": "Who should speak next?", "criteria": {}}}
  },
  "stt_options": {"model": "saaras:v3", "mode": "translit", "language_code": "unknown", "with_diarization": true, "with_timestamps": true}
}
```

The empty text `criteria` above is abbreviated for display; real rows contain the
complete recorded criteria. `model` is added by the provider adapter at runtime.
The private `context` can include structured, bounded history and inferred graph
or tool configuration. It must not include future dialogue or human answer fields.

## A reference answer

References are in a separate file and are not passed to predictor callbacks.

```json
{"id": "unique_question_id", "label": "caller", "accepted_labels": ["caller"]}
```

## A prediction

```json
{"id": "unique_question_id", "choice": "caller"}
```

Optional `probabilities` must map exactly the question's option IDs to finite
numbers in [0,1] summing to one. The choice must maximize that distribution.
An explicit failure can instead be recorded as `{"id": "...", "error": "..."}`.
The runner also stores the model ID and dataset fingerprint for safe resuming.

Full-benchmark question IDs, contexts, reference labels and audio must remain
private. Public examples use independent `example-01` through `example-06` IDs.
