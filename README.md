# DECIDE

**Decision Evaluation in Calls: Intent, Dialogue and Emotion**

A benchmark for the local decisions a voice agent makes during a conversation:
understanding caller intent, choosing graph routes and external tools, allocating
the next turn, and interpreting emotion, speakers, disturbance and language changes.

[Website](https://decide-benchmark.vercel.app) · **Paper / arXiv: coming soon** ·
[Audio examples](https://decide-benchmark.vercel.app/#examples) ·
[Model submissions](mailto:support@tazolabs.com?subject=DECIDE%20model%20submission)

DECIDE v1.0 contains **4,867 decision questions over 1,081 audio clips and 32 tasks**.
Clips are 3–25 seconds long and come from 570 production calls across 34 agents,
supplied by [Bolna](https://www.bolna.ai/). The benchmark predominantly covers
college-admissions conversations in English and Hindi. A clip can support multiple
decision questions. The human annotation team comprised four annotators.

**The full benchmark is not distributed to participants.** This public repository
contains the integration toolkit, website, and exactly six preview examples.
Full recordings, transcripts, contexts and reference labels remain in private
maintainer-controlled storage. Participants must not be granted dataset access.

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

### Full benchmark: bring the model to the data

Participants do not download the benchmark, receive Hugging Face access, or run
full evaluation on their devices. The intended workflow is:

1. Submit model weights and inference code, or a compatible inference container.
2. Benchmark operators review and run the model on controlled, isolated infrastructure.
3. Private workers load the benchmark internally and score predictions against private labels.
4. Participants receive reviewed aggregate metrics and task-level breakdowns only.

**A public hosted submission service is not yet implemented.** Contact
[support@tazolabs.com](mailto:support@tazolabs.com?subject=DECIDE%20model%20submission)
to discuss the model and execution requirements. The public repository currently
supports local integration tests on the six previews, plus an internal operator
entry point. Do not interpret the local runner as a secure sandbox for submitted code.

Calling a participant-controlled model API sends that operator the benchmark
inputs. That is incompatible with keeping the inputs hidden from the model owner.
Strict private evaluation requires executing the model within controlled infrastructure,
with restricted network access and controlled outputs. Private storage credentials,
raw logs, per-question predictions and reference labels are not shared with participants.

### Test your integration on the six public examples

Copy `examples/custom_model.py` to `examples/my_model.py` and implement `predict(example)`.
Your callback receives permitted context, instructions, ordered criteria and, in
`audio` mode, the exact preview WAV path. Return an allowed choice ID or a distribution:

```python
{"choice": "caller", "probabilities": {
    "agent": 0.1, "caller": 0.8, "end_call": 0.05, "insufficient_evidence": 0.05
}}
```

The options vary per question; preserve their IDs and order. Reference answers
are never passed to the predictor callback. In `text` mode, the supplied STT
representation is in `example["request"]["state"]["clip_transcript"]`.

```bash
python evaluation.py run --preview \
  --predictor examples.my_model:predict --modality audio \
  --model my-model-version --concurrency 1 --output runs/my-model-preview
```

For built-in adapters, set the corresponding key in `.env`:

```bash
python evaluation.py run --preview --provider tazo --output runs/tazo-preview
python evaluation.py run --preview --provider jev --output runs/jev-preview
```

The Jev preview uses bundled STT text and does not send audio to Jev. Your own
API can be used for these **public previews**. It is not a route to hidden full-data
access. Custom predictors must handle their own rate limits and retries.

To score predictions for the six previews produced elsewhere:

```bash
python evaluation.py score --preview --predictions my-preview-predictions.jsonl \
  --output runs/my-preview-score.json
```

Each prediction must include the public example ID and a valid choice:

```json
{"id": "example-04", "choice": "caller"}
```

The public CLI has no `download` command or private `--data` option and requires
`--preview`. The six-example score is an integration check, not a full benchmark score.
Re-running the same preview command/output directory resumes successful results;
use a new directory after changing model code or configuration.

### Internal scoring and versioning

The internal evaluator reports accuracy, accepted accuracy, coverage, task-macro
accuracy and task/family/duration breakdowns. Missing or failed predictions count
as incorrect in the main accuracy. Model inputs and reference answers are separated.
The full v1.0 question membership and labels remain frozen; annotation changes
require a new dataset version and evaluation outputs.

Full data operations are for benchmark operators only, using
`tools/maintainer_evaluation.py` on controlled infrastructure. That script is a
workflow distinction, not an access-control boundary: private credentials and
execution isolation enforce confidentiality. See the [maintainer guide](docs/maintaining.md).
Do not grant participants storage access as a way to run the benchmark.

See [the protocol](docs/protocol.md) and the [internal dataset format](docs/dataset-format.md).

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
data is restricted to operators and controlled workers, not participants. Do not commit private data or outputs
containing conversation text to a public repository.
