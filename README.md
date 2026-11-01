# DECIDE

**Decision Evaluation in Calls: Intent, Dialogue and Emotion**

A benchmark for the local decisions a voice agent makes during a conversation:
understanding caller intent, choosing graph routes and external tools, allocating
the next turn, and interpreting emotion, speakers, disturbance and language changes.

[Website](https://decide-benchmark.vercel.app) · **Paper / arXiv: coming soon** ·
[Audio examples](https://decide-benchmark.vercel.app/#examples) ·
[Request access](mailto:support@tazolabs.com?subject=DECIDE%20benchmark%20access)

DECIDE v1.0 contains **4,867 decision questions over 1,081 audio clips and 32 tasks**.
Clips are 3–25 seconds long and come from 570 production calls across 34 agents,
supplied by [Bolna](https://www.bolna.ai/). The benchmark predominantly covers
college-admissions conversations in English and Hindi. A clip can support multiple
decision questions. The human annotation team comprised four annotators.

**The full benchmark is private.** This public repository contains the evaluation
code, website, and exactly six preview examples. Full audio, transcripts, contexts
and reference labels are stored in a [private Hugging Face dataset](https://huggingface.co/datasets/tazolabs/DECIDE).
A private-repository link may return 404 until your account is granted access.

## Tasks

| Family | Examples | Questions |
| --- | --- | ---: |
| Business and conversation | Lead interest, callback requests, availability, programme preference | 1,403 |
| Graph routing | Route action and next destination | 743 |
| Tool decisions | External-tool selection and execution readiness | 128 |
| Turn taking | Agent, caller, end call or insufficient evidence | 376 |
| Voice properties | Caller emotion, speaker count and disturbance | 1,886 |
| Language switching | A change of spoken language within the clip | 331 |

The model sees an exact audio clip, a question and ordered candidate decisions,
plus permitted context where relevant. It must select one candidate at the clip's
end. Future dialogue, human labels and annotator notes are not model inputs.

## Quick start

Requires **Python 3.11+**. No model API key is required to validate data or score
saved predictions. Only actual model inference requires provider credentials.

```bash
git clone https://github.com/tazolabs/DECIDE.git
cd DECIDE
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Check the six public examples and their exact WAV files.
python evaluation.py validate --preview
```

The preview is for understanding the task and testing integration. Its six scores
are not full-benchmark results. Preview prompts use abbreviated, de-identified
context; the private v1.0 bundle preserves the recorded benchmark prompts.

## Evaluation

### 1. Obtain the private benchmark

Request access from the maintainers and authenticate with the Hugging Face account
that was granted access. A Hugging Face token does not by itself grant permission.

```bash
hf auth login
python evaluation.py download --revision v1.0
python evaluation.py validate --data data/decide-v1
```

Alternatively, use a maintainer-provided local export via `--data /path/to/export`.
Downloads go into the ignored `data/` directory. The version is pinned to the
`v1.0` dataset tag by default. Future annotation changes require a new release;
they do not silently alter published v1.0 results.

### 2. Run Tazo with audio

Copy `.env.example` to `.env` and set `TAZO_BEARER_TOKEN`. Keep credentials local.

```bash
# Smoke test: six public examples.
python evaluation.py run --preview --provider tazo --output runs/tazo-preview

# Full benchmark: uses the exact versioned audio prompts and clips.
python evaluation.py run --data data/decide-v1 --provider tazo \
  --model tazo-large --concurrency 2 --requests-per-second 1 \
  --output runs/tazo-v1
```

### 3. Run the STT + Jev baseline

Set `JEV_API_KEY` in `.env`.

```bash
python evaluation.py run --preview --provider jev --output runs/jev-preview

python evaluation.py run --data data/decide-v1 --provider jev \
  --model jev-1.13.0 --concurrency 2 --requests-per-second 1 \
  --output runs/jev-v1
```

This adapter uses **frozen Sarvam STT representations bundled privately with the
benchmark**, including anonymous speaker segments and timestamps. It sends JSON
to Jev and never sends audio to Jev. It does not re-transcribe audio or incur new
STT charges. Transcription settings are recorded per question: the original
comparison used `transcribe` for business/voice/tools and `translit` for
routing/turn/language tasks. Audio and text prompt variants retain their recorded
instructions, including text-modality guidance; they are not claimed to be
identical prompts or an isolated test of modality.

To evaluate a different STT system, use a custom audio-mode adapter that transcribes
the supplied WAV before calling your text decision model. Record the STT/model
versions and prompt changes with your results. Do not use the source transcript
as a substitute for STT.

### 4. Use your own model

Implement `predict(example)` in a Python module. See
[`examples/custom_model.py`](examples/custom_model.py) for the input contract.
The function receives only the selected modality, allowed context, question,
criteria and metadata. Reference answers are never passed to the function.

```bash
python evaluation.py run --preview \
  --predictor examples.my_model:predict --modality audio \
  --model my-model-version --output runs/my-model-preview

python evaluation.py run --data data/decide-v1 \
  --predictor examples.my_model:predict --modality text \
  --model my-text-model-version --output runs/my-text-model-v1
```

Return an option ID, `{"choice": "option_id"}`, or a complete distribution:

```python
{"choice": "caller", "probabilities": {
    "agent": 0.1, "caller": 0.8, "end_call": 0.05, "insufficient_evidence": 0.05
}}
```

Option IDs must exactly match that question's criteria. Probability keys must
match all choices, values must sum to one, and the chosen ID must have maximal
probability. Custom predictors may run concurrently; use `--concurrency 1` for
models that require serial execution. The shared rate limiter applies to built-in
provider adapters; custom adapters must handle their own API limits and retries.

### 5. Score predictions produced elsewhere

Write one JSON object per line, using the supplied question IDs:

```json
{"id": "example-04", "choice": "caller"}
```

```bash
python evaluation.py score --preview --predictions my-predictions.jsonl \
  --output runs/my-preview-score.json

python evaluation.py score --data data/decide-v1 \
  --predictions my-full-predictions.jsonl --output runs/my-full-score.json
```

Scoring rejects unknown/duplicate IDs, out-of-vocabulary choices and invalid
probability distributions. Missing or explicitly failed rows count as incorrect
in the main accuracy. Coverage and accuracy over valid predictions are reported
separately. Reports include per-task, per-family and duration breakdowns, plus
the unweighted mean over the selected tasks.

### Filters, saved outputs and resuming

Use `--task graph.route_action`, `--task graph.destination_node` or
`--task conversation.next_speaker`; repeat `--task` to combine tasks. `--limit 5`
selects the first five eligible rows for a smoke test, not a random benchmark.

Each run writes `run.json`, `predictions.jsonl`, and `report.json` under the chosen
output directory. Rerun the **same command and output directory** to resume:
successful predictions are reused, while failed or unattempted rows are retried.
A different dataset, selection, model, modality or prompt fingerprint requires
a new output directory. Use a new directory after changing custom model code too.
For filtered external scoring, pass the same `--task` and `--limit` filters.

See [the protocol](docs/protocol.md) and [dataset format](docs/dataset-format.md).

## Website

The website is buildless HTML/CSS/JavaScript in `site/`. Only that directory is
deployed to Vercel; the `.vercelignore` allowlist excludes Python code, local
downloads, credentials and evaluation outputs from deployment uploads.

```bash
python3 -m http.server 8080 --directory site
# Open http://localhost:8080
```

The paper button is deliberately marked **Coming soon**. When arXiv is available,
update the button in `site/index.html`, the README links and the citation.

Maintainers: see [release and deployment instructions](docs/maintaining.md).

## Citation

Provisional citation; the paper's arXiv identifier will be added when available.

```bibtex
@misc{decide2026,
  title = {DECIDE: Decision Evaluation in Calls: Intent, Dialogue and Emotion},
  author = {Pare, Harsh and Jain, Naman and Singh, Sachin Kumar and
            Sahit, Jayakrishna and Batra, Siddharth and Bhat, Sanket and
            Ayyagari, Surya Vamsee},
  year = {2026},
  howpublished = {\url{https://github.com/tazolabs/DECIDE}}
}
```

## License and data use

The evaluator and website source are MIT licensed. That software license does
**not** apply to recordings, transcripts, annotations or the private dataset.
The six preview recordings are provided for viewing/listening on the project
page; no general redistribution or training license is granted. Full benchmark
access requires separate authorization. Do not commit private data or outputs
containing conversation text to a public repository.
