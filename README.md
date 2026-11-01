# DECIDE

**Decision Evaluation in Calls: Intent, Dialogue and Emotion**

A benchmark for the local decisions a voice agent makes during a conversation:
understanding caller intent, choosing graph routes and external tools, allocating
the next turn, and interpreting emotion, speakers, disturbance and language changes.

[Website](https://decide-benchmark.vercel.app) · **Paper / arXiv: coming soon** ·
[Audio examples](https://decide-benchmark.vercel.app/#examples) ·
[Evaluate a model](https://decide-benchmark.vercel.app/evaluate)

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

### Full benchmark: submit your model API

Use the [hosted evaluation page](https://decide-benchmark.vercel.app/evaluate), or
submit from this CLI. Request an invitation from
[support@tazolabs.com](mailto:support@tazolabs.com?subject=DECIDE%20evaluation%20invitation)
with your model's HTTPS endpoint. Invitations are endpoint-bound, expire, and
have a run quota. First verify the [model API contract](docs/hosted-api.md).

Set these values in your local `.env` (never commit it):

```dotenv
DECIDE_SUBMISSION_TOKEN=your-invitation-token
MODEL_API_KEY=your-model-api-key
```

Start with the six public integration examples, then submit the full benchmark
using a **new receipt path**:

```bash
python evaluation.py submit --endpoint https://api.example.com/v1/decisions \
  --model my-model-version --modality audio --mode preview \
  --receipt runs/my-preview-receipt.json
python evaluation.py status --receipt runs/my-preview-receipt.json --wait

python evaluation.py submit --endpoint https://api.example.com/v1/decisions \
  --model my-model-version --modality audio \
  --receipt runs/my-benchmark-receipt.json
python evaluation.py status --receipt runs/my-benchmark-receipt.json --wait
```

Use `--modality text` for a text model. The worker supplies the release's frozen
STT text with the corresponding text prompt; participants do not run STT or
receive its transcripts. The CLI submits configuration only and downloads no
benchmark files. The job continues if your terminal or browser closes. Retry a
failed submission with the **same receipt path and settings** to avoid creating
a duplicate job. Keep receipts private: they grant read/cancel access to results.

```bash
python evaluation.py cancel --receipt runs/my-benchmark-receipt.json
```

The worker retrieves private data, sends permitted model inputs, and scores
responses against private references. Only aggregate results are returned after
completion. API keys are encrypted while queued/running and deleted on completion,
failure or cancellation. Small breakdown cells (<10 questions) are suppressed.
Model API usage is billed by your provider, including any retries.

**Privacy boundary:** the external model API operator receives inference inputs
(audio or STT text, prompts and permitted context). This is an API-based evaluation,
not a mechanism to hide inputs from that operator. Reference labels, private
storage credentials, downloadable dataset files and per-question results are not
shared. Participants who require zero input disclosure would need a separately
arranged model-to-data execution environment.

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

The public CLI has no `download` command or private `--data` option. Local
validation, inference and scoring require `--preview`; hosted commands use job receipts. The six-example score is an integration check, not a full benchmark score.
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

The website is buildless HTML/CSS/JavaScript in `site/`. That directory supplies public assets. The `api/` and `server/` modules run the
hosted evaluator on Vercel with a private queue and Neon database. The deployment
allowlist excludes Python code, local datasets, credentials and evaluation outputs.

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
